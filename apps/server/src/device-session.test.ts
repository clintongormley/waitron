/**
 * The device cookie and the three guards that read it.
 *
 * Every fixture below writes through its TABLE DEFINITION rather than as raw SQL: each table's `id`
 * (and its creation timestamps) is a `$defaultFn` generator raw SQL never reaches, and the table
 * definition is what encodes the JSON and list columns.
 */
import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  canvases,
  deviceProfiles,
  devices,
  kitchenStations,
  locations,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { DEFAULT_CANVASES } from "@waitron/layouts";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import {
  DEV_DEVICE_HEADER,
  DEVICE_COOKIE,
  assertDeviceCapability,
  assertNotHandheld,
  clearDeviceCookie,
  cookieDomainFor,
  readDeviceCookie,
  requireDevice,
  requireSaleTillId,
  setDeviceCookie,
  tryReadDevice,
} from "./device-session.js";
import type { DeviceBinding } from "./device-session.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

function asApp<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/**
 * Each database-backed test seeds its own venue, so the device state each case reads is its own.
 */
async function setupStation(): Promise<{ cfg: TillConfig; stationId: string }> {
  const admin = suite.db;
  await seedTenant(admin);
  const [loc] = await admin
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await admin
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(admin, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const st = await asApp(admin, (tx) =>
    createStation(tx, cfg, { name: "Cocina", isDefault: true }),
  );
  return { cfg, stationId: st.id };
}

/** Enrol a REAL device via join-and-accept — the only way to obtain a `${deviceId}.${token}` whose
 * scrypt hash actually verifies. Returns the plaintext token the accept route would set in the
 * cookie, never at rest. */
async function enrolDeviceFixture(): Promise<{
  cfg: TillConfig;
  deviceId: string;
  token: string;
  stationId: string;
  deviceProfileId: string;
}> {
  const { cfg, stationId } = await setupStation();
  const deviceProfileId = await seedDeviceProfile("Pantalla profile", "kds", []);
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: "Pantalla",
    profileId: deviceProfileId,
    stationId,
  });
  return { cfg, deviceId: dev.deviceId, token: dev.token, stationId, deviceProfileId };
}

/** The bindings a device enrolled with NONE assigned surfaces: a `kds_station` (like
 * `enrolDeviceFixture`'s) binds no till and no hardware, so every binding is the column default. */
const NO_BINDINGS = {
  tillId: null,
  receiptPrinterId: null,
  // `enrolDeviceFixture`'s kds profile declares no capabilities, so the binding carries `[]`.
  capabilities: [],
} as const;

/**
 * Insert a device profile for the capability checks. canvasId is optional.
 */
async function seedDeviceProfile(
  name: string,
  formFactor: FormFactor,
  capabilities: CapabilityFlag[],
  canvasId: string | null = null,
): Promise<string> {
  const [prof] = await suite.db
    .insert(deviceProfiles)
    .values({ name, formFactor, canvasId, capabilities })
    .returning({ id: deviceProfiles.id });
  return prof!.id;
}

/**
 * Enrol a till device with profile and hardware bindings. Leave receiptPrinterId
 * null so no printer fixture is needed.
 */
async function enrolTillDeviceFixture(): Promise<{
  cfg: TillConfig;
  deviceId: string;
  token: string;
  deviceProfileId: string;
  tillId: string;
}> {
  const { cfg } = await setupStation();
  const [canvas] = await suite.db
    .insert(canvases)
    .values({ name: "Front counter", definition: DEFAULT_CANVASES.till })
    .returning({ id: canvases.id });
  const canvasId = canvas!.id;
  // This fixture explicitly grants reader and drawer access. The device binds the canvas SOLELY
  // through this profile, and a `till` profile AUTO-CREATES the register the device rings against.
  const deviceProfileId = await seedDeviceProfile(
    "Counter",
    "till",
    ["integrated-card-payment", "open-cash-drawer"],
    canvasId,
  );
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: "Counter till",
    profileId: deviceProfileId,
  });
  const { rows } = await suite.db.execute<{ till_id: string }>(sql`
    select till_id from devices where id = ${dev.deviceId}`);
  return {
    cfg,
    deviceId: dev.deviceId,
    token: dev.token,
    deviceProfileId,
    tillId: rows[0]!.till_id,
  };
}

/**
 * Deactivate the device for the revocation test.
 */
async function revoke(deviceId: string): Promise<void> {
  await suite.db.execute(sql`update devices set active = false where id = ${deviceId}`);
}

/**
 * Read last_seen_at to compare the value before and after device validation.
 */
async function lastSeenAt(deviceId: string): Promise<string | null> {
  const { rows } = await suite.db.execute<{ last_seen_at: string | null }>(
    sql`select last_seen_at from devices where id = ${deviceId}`,
  );
  return rows[0]!.last_seen_at;
}

type ProbeResult = { ok: true; binding: DeviceBinding } | { ok: false; code: string };

/**
 * The shared one-route scaffold every guard probe runs behind: a fresh Hono app whose sole
 * `GET /probe` runs `handler`, carrying the given cookie value (or none), with an `onError` that
 * captures any throw.
 */
async function runProbe(
  cookieValue: string | null,
  handler: (deps: { db: Database }, c: Context) => Promise<Response>,
): Promise<{ res: Response; thrown: unknown }> {
  const app = new Hono();
  const deps = { db: suite.db };
  let thrown: unknown;
  app.get("/probe", (c) => handler(deps, c));
  app.onError((err, c) => {
    thrown = err;
    return c.body(null, 500);
  });
  const res = await app.request(
    "/probe",
    cookieValue === null ? undefined : { headers: { cookie: `${DEVICE_COOKIE}=${cookieValue}` } },
  );
  return { res, thrown };
}

/** Run `requireDevice` behind the shared scaffold. Returns the binding on success or the thrown code on
 * failure. */
async function probe(cookieValue: string | null): Promise<ProbeResult> {
  const { res, thrown } = await runProbe(cookieValue, async (deps, c) =>
    c.json(await requireDevice(deps, c)),
  );
  if (res.status === 200) {
    return { ok: true, binding: (await res.json()) as DeviceBinding };
  }
  return { ok: false, code: isAppError(thrown) ? thrown.code : String(thrown) };
}

/** Enrol a REAL handheld device — no station (a handheld form factor binds none) — so
 * `tryReadDevice` resolves its cookie to a `handheld` binding. Same enrol path as `enrolDeviceFixture`,
 * with the order-only kind. */
async function enrolHandheldFixture(): Promise<{
  cfg: TillConfig;
  deviceId: string;
  token: string;
}> {
  const { cfg } = await setupStation();
  // A handheld is defined by a `phone-portrait`/`tablet-landscape` profile and, being sale-capable,
  // binds an EXISTING register at enrol — the venue's own till.
  const deviceProfileId = await seedDeviceProfile("Waiter phone profile", "phone-portrait", []);
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: "Waiter phone",
    profileId: deviceProfileId,
    registerId: cfg.tillId,
  });
  return { cfg, deviceId: dev.deviceId, token: dev.token };
}

/** Run the NON-throwing `tryReadDevice` behind the shared scaffold, returning the binding or `null` it
 * resolves the cookie to — the `probe` shape, but reading the JSON-encoded value instead of catching a
 * throw (a `null` round-trips as `null`). */
async function probeTry(cookieValue: string | null): Promise<DeviceBinding | null> {
  const { res } = await runProbe(cookieValue, async (deps, c) =>
    c.json((await tryReadDevice(deps, c)) ?? null),
  );
  return (await res.json()) as DeviceBinding | null;
}

/** Run `assertNotHandheld` behind the shared HTTP scaffold: `{ ok: true }` when it passes (no throw), or
 * the thrown code when it refuses. */
async function probeAssert(
  cookieValue: string | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const { res, thrown } = await runProbe(cookieValue, async (deps, c) => {
    await assertNotHandheld(deps, c, "record_sale");
    return c.body(null, 204);
  });
  if (res.status === 204) return { ok: true };
  return { ok: false, code: isAppError(thrown) ? thrown.code : String(thrown) };
}

/**
 * Enrol a handheld with a profile declaring no capabilities, so the capability
 * checks refuse integrated card payment and cash drawer access.
 */
async function enrolHandheldWithCanvasFixture(): Promise<{
  cfg: TillConfig;
  deviceId: string;
  token: string;
}> {
  const { cfg } = await setupStation();
  const [canvas] = await suite.db
    .insert(canvases)
    .values({ name: "Waiter phone", definition: DEFAULT_CANVASES["phone-portrait"] })
    .returning({ id: canvases.id });
  const canvasId = canvas!.id;
  // A handheld (`phone-portrait`) binds an EXISTING register at enrol — the venue's own till.
  const deviceProfileId = await seedDeviceProfile("Waiter", "phone-portrait", [], canvasId);
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: "Waiter phone",
    profileId: deviceProfileId,
    registerId: cfg.tillId,
  });
  return { cfg, deviceId: dev.deviceId, token: dev.token };
}

/** Run `assertDeviceCapability` behind the shared HTTP scaffold: `{ ok: true }` when it passes (no
 * throw), or the thrown code + params when it refuses. */
async function probeCapability(
  cookieValue: string | null,
  capability: CapabilityFlag,
  action: string,
): Promise<{ ok: true } | { ok: false; code: string; params: unknown }> {
  const { res, thrown } = await runProbe(cookieValue, async (deps, c) => {
    await assertDeviceCapability(deps, c, capability, action);
    return c.body(null, 204);
  });
  if (res.status === 204) return { ok: true };
  return {
    ok: false,
    code: isAppError(thrown) ? thrown.code : String(thrown),
    params: isAppError(thrown) ? thrown.params : undefined,
  };
}

const COOKIE_VALUE = "11111111-1111-4111-8111-111111111111.token_ABC-123";

describe("device cookie helpers", () => {
  it("setDeviceCookie sets httpOnly, Secure, SameSite=Strict, Path=/, and a long Max-Age", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setDeviceCookie(c, COOKIE_VALUE, true);
      return c.body(null, 204);
    });
    const res = await app.request("/set");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DEVICE_COOKIE}=${COOKIE_VALUE}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
    // 60*60*24*365 — a full year, so a kitchen screen stays enrolled across reboots. The
    // session cookies deliberately carry NO Max-Age; this one deliberately does.
    expect(cookie).toMatch(/Max-Age=31536000/i);
  });

  it("setDeviceCookie omits Secure on a non-TLS host", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setDeviceCookie(c, COOKIE_VALUE, false);
      return c.body(null, 204);
    });
    const res = await app.request("/set");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DEVICE_COOKIE}=${COOKIE_VALUE}`);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("setDeviceCookie writes Domain only when the host is under the tenant domain", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setDeviceCookie(c, COOKIE_VALUE, true, "deli.waitron.app");
      return c.body(null, 204);
    });
    const scoped =
      (await app.request("/set", { headers: { host: "box.deli.waitron.app" } })).headers.get(
        "set-cookie",
      ) ?? "";
    expect(scoped).toMatch(/Domain=deli\.waitron\.app/i);
    const hostOnly =
      (await app.request("/set", { headers: { host: "waitron.local" } })).headers.get(
        "set-cookie",
      ) ?? "";
    expect(hostOnly).not.toMatch(/Domain=/i);
    // No tenantDomain at all ⇒ host-only regardless of the host.
    const app2 = new Hono();
    app2.get("/set", (c) => {
      setDeviceCookie(c, COOKIE_VALUE, true);
      return c.body(null, 204);
    });
    const none =
      (await app2.request("/set", { headers: { host: "box.deli.waitron.app" } })).headers.get(
        "set-cookie",
      ) ?? "";
    expect(none).not.toMatch(/Domain=/i);
  });

  it("clearDeviceCookie expires the cookie (Max-Age=0, matching Path)", async () => {
    const app = new Hono();
    app.get("/clear", (c) => {
      clearDeviceCookie(c);
      return c.body(null, 204);
    });
    const res = await app.request("/clear");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DEVICE_COOKIE}=`);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  // The clearing Set-Cookie must carry the SAME `Domain` the set one did — resolved from the same
  // `tenantDomain` + host inputs — or the browser keeps the domain-scoped cookie alongside the
  // host-only expiry (the `Path` reasoning, applied to `Domain`).
  it("clearDeviceCookie writes Domain only when the host is under the tenant domain", async () => {
    const app = new Hono();
    app.get("/clear", (c) => {
      clearDeviceCookie(c, "deli.waitron.app");
      return c.body(null, 204);
    });
    const scoped = await app.request("/clear", { headers: { host: "box.deli.waitron.app" } });
    const scopedCookie = scoped.headers.get("set-cookie") ?? "";
    expect(scopedCookie).toMatch(/Domain=deli\.waitron\.app/i);
    expect(scopedCookie).toMatch(/Max-Age=0/i);
    const hostOnly = await app.request("/clear", { headers: { host: "waitron.local" } });
    expect(hostOnly.headers.get("set-cookie") ?? "").not.toMatch(/Domain=/i);
  });

  describe("cookieDomainFor", () => {
    it("scopes to the tenant domain for a host under it (port stripped, case-insensitive)", () => {
      expect(cookieDomainFor("box.deli.waitron.app", "deli.waitron.app")).toBe("deli.waitron.app");
      expect(cookieDomainFor("Box.Deli.Waitron.App:8443", "deli.waitron.app")).toBe(
        "deli.waitron.app",
      );
      expect(cookieDomainFor("deli.waitron.app", "deli.waitron.app")).toBe("deli.waitron.app");
    });
    it("stays host-only for waitron.local, loopback, a look-alike, or no tenant domain", () => {
      expect(cookieDomainFor("waitron.local", "deli.waitron.app")).toBeUndefined();
      expect(cookieDomainFor("localhost:8080", "deli.waitron.app")).toBeUndefined();
      expect(cookieDomainFor("notdeli.waitron.app", "deli.waitron.app")).toBeUndefined();
      expect(cookieDomainFor("box.deli.waitron.app", undefined)).toBeUndefined();
      expect(cookieDomainFor(undefined, "deli.waitron.app")).toBeUndefined();
    });
  });

  it("readDeviceCookie returns the value when present and null when absent", async () => {
    const app = new Hono();
    app.get("/read", (c) => c.json({ value: readDeviceCookie(c) }));
    const present = await app.request("/read", {
      headers: { cookie: `${DEVICE_COOKIE}=${COOKIE_VALUE}` },
    });
    expect(await present.json()).toEqual({ value: COOKIE_VALUE });
    const absent = await app.request("/read");
    expect(await absent.json()).toEqual({ value: null });
  });
});

describe("requireDevice (real Postgres)", () => {
  it("authenticates a valid cookie and touches last_seen_at", async () => {
    const { deviceId, token, stationId, deviceProfileId } = await enrolDeviceFixture();
    expect(await lastSeenAt(deviceId)).toBeNull(); // never seen yet

    const result = await probe(`${deviceId}.${token}`);
    expect(result).toEqual({
      ok: true,
      binding: {
        deviceId,
        formFactor: "kds",
        label: "Pantalla",
        stationId,
        deviceProfileId,
        ...NO_BINDINGS,
      },
    });

    expect(await lastSeenAt(deviceId)).not.toBeNull(); // the guard recorded the sighting
  });

  it("carries the device's assigned profile + till + hardware bindings back on the binding (SP-A.2 §16, device-profile §5)", async () => {
    const { deviceId, token, deviceProfileId, tillId } = await enrolTillDeviceFixture();
    // The canvas is not a device field; it resolves THROUGH the profile at `/api/till`. The till is the
    // register the `till` profile auto-created at enrol.
    expect(await probe(`${deviceId}.${token}`)).toEqual({
      ok: true,
      binding: {
        deviceId,
        formFactor: "till",
        label: "Counter till",
        stationId: null,
        tillId,
        deviceProfileId,
        receiptPrinterId: null,
        // The `till` profile declares both fenced flags — carried on the binding by the profile join.
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
      },
    });
  });

  it("rejects a WRONG token with device.unauthorized and does not touch last_seen_at", async () => {
    const { deviceId } = await enrolDeviceFixture();
    const result = await probe(`${deviceId}.not-the-real-token`);
    expect(result).toEqual({ ok: false, code: "device.unauthorized" });
    // A failed authentication is a no-op on the row: the sighting is recorded only after verify.
    expect(await lastSeenAt(deviceId)).toBeNull();
  });

  it("rejects a MALFORMED cookie (no dot, empty part, non-uuid selector, absent) with device.unauthorized", async () => {
    await enrolDeviceFixture();
    for (const bad of [
      "no-dot-here", // no separator
      "", // empty
      ".tokenonly", // empty selector
      "11111111-1111-4111-8111-111111111111.", // empty token
      "not-a-uuid.sometoken", // non-uuid selector
    ]) {
      expect(await probe(bad)).toEqual({ ok: false, code: "device.unauthorized" });
    }
    expect(await probe(null)).toEqual({ ok: false, code: "device.unauthorized" });
  });

  it("rejects an UNKNOWN device id with device.unauthorized", async () => {
    const { token } = await enrolDeviceFixture();
    const result = await probe(`${randomUUID()}.${token}`);
    expect(result).toEqual({ ok: false, code: "device.unauthorized" });
  });

  it("rejects a REVOKED device (active = false) with device.unauthorized — instant revocation", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    // It authenticates while active…
    expect((await probe(`${deviceId}.${token}`)).ok).toBe(true);
    // …and stops the instant it is revoked, with no token TTL to wait out.
    await revoke(deviceId);
    const result = await probe(`${deviceId}.${token}`);
    expect(result).toEqual({ ok: false, code: "device.unauthorized" });
  });
});

describe("tryReadDevice and assertNotHandheld (real Postgres)", () => {
  it("tryReadDevice returns the binding for a valid cookie and null at every miss", async () => {
    const { deviceId, token, stationId, deviceProfileId } = await enrolDeviceFixture();
    // Success resolves to the same binding `requireDevice` returns.
    expect(await probeTry(`${deviceId}.${token}`)).toEqual({
      deviceId,
      formFactor: "kds",
      label: "Pantalla",
      stationId,
      deviceProfileId,
      ...NO_BINDINGS,
    });
    // Every point where `requireDevice` throws `device.unauthorized`, the core returns `null`: no dot,
    // empty, empty selector, empty token, non-uuid selector, unknown id, wrong token.
    for (const bad of [
      "no-dot-here",
      "",
      ".tokenonly",
      `${deviceId}.`,
      "not-a-uuid.sometoken",
      `${randomUUID()}.${token}`,
      `${deviceId}.not-the-real-token`,
    ]) {
      expect(await probeTry(bad)).toBeNull();
    }
    expect(await probeTry(null)).toBeNull(); // absent cookie
  });

  it("assertNotHandheld refuses an ACTIVE handheld with device.forbidden_action", async () => {
    const { deviceId, token } = await enrolHandheldFixture();
    expect(await probeAssert(`${deviceId}.${token}`)).toEqual({
      ok: false,
      code: "device.forbidden_action",
    });
  });

  it("assertNotHandheld passes a non-handheld device, an absent cookie, and a failed device cookie", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    // A kds_station device is not order-only — it never posts to a sale route, and the firewall does
    // not block it here.
    expect(await probeAssert(`${deviceId}.${token}`)).toEqual({ ok: true });
    // An ordinary till carries NO device cookie: `tryReadDevice` → null → the firewall passes.
    expect(await probeAssert(null)).toEqual({ ok: true });
    // A malformed/unauthenticated device cookie is a miss (null), not a handheld, so it passes too —
    // the order-only rule blocks ONLY a verified handheld, never a non-device caller.
    expect(await probeAssert("not-a-uuid.sometoken")).toEqual({ ok: true });
  });
});

describe("assertDeviceCapability (real Postgres)", () => {
  it("refuses a device whose assigned PROFILE LACKS the capability, naming the action", async () => {
    // The handheld's profile carries `capabilities: []` — it lacks BOTH fenced flags.
    const { deviceId, token } = await enrolHandheldWithCanvasFixture();
    expect(await probeCapability(`${deviceId}.${token}`, "integrated-card-payment", "pay")).toEqual(
      { ok: false, code: "device.forbidden_action", params: { action: "pay" } },
    );
    expect(
      await probeCapability(`${deviceId}.${token}`, "open-cash-drawer", "drawer_open"),
    ).toEqual({ ok: false, code: "device.forbidden_action", params: { action: "drawer_open" } });
  });

  it("passes a device whose assigned PROFILE HAS the capability", async () => {
    // This till fixture explicitly declares reader and drawer capabilities.
    const { deviceId, token } = await enrolTillDeviceFixture();
    expect(await probeCapability(`${deviceId}.${token}`, "integrated-card-payment", "pay")).toEqual(
      { ok: true },
    );
    expect(
      await probeCapability(`${deviceId}.${token}`, "open-cash-drawer", "drawer_open"),
    ).toEqual({ ok: true });
  });

  it("refuses a device whose assigned profile declares NO capabilities — fail-closed", async () => {
    // `device_profile_id` is NOT NULL, so the fail-closed case is a profile that declares an EMPTY
    // capability set — `enrolDeviceFixture`'s kds profile has `capabilities: []`.
    const { deviceId, token } = await enrolDeviceFixture();
    expect(await probeCapability(`${deviceId}.${token}`, "integrated-card-payment", "pay")).toEqual(
      { ok: false, code: "device.forbidden_action", params: { action: "pay" } },
    );
  });

  it("passes when there is NO device cookie (an env-configured / legacy till)", async () => {
    // No `waitron_device` cookie ⇒ `tryReadDevice` → null ⇒ pass, exactly as `assertNotHandheld`.
    // Nothing blocks a sale on a cookie-less till (CLAUDE.md §5).
    await enrolDeviceFixture();
    expect(await probeCapability(null, "integrated-card-payment", "pay")).toEqual({
      ok: true,
    });
    expect(await probeCapability(null, "open-cash-drawer", "drawer_open")).toEqual({
      ok: true,
    });
  });

  it("preserves the handheld firewall: a handheld (profile caps []) is still blocked from pay + drawer", async () => {
    // A handheld's capability-less profile carries neither flag, so pay and drawer are refused by
    // capability, not by device kind.
    const { deviceId, token } = await enrolHandheldWithCanvasFixture();
    expect(
      (await probeCapability(`${deviceId}.${token}`, "integrated-card-payment", "pay")).ok,
    ).toBe(false);
    expect(
      (await probeCapability(`${deviceId}.${token}`, "open-cash-drawer", "drawer_open")).ok,
    ).toBe(false);
  });
});

/**
 * Runs `tryReadDevice` inside a one-route Hono app with an arbitrary header set (the `probe` helpers
 * only carry a cookie), so the dev-override header can be driven directly.
 */
async function readWithHeaders(
  deps: Parameters<typeof tryReadDevice>[0],
  headers: Record<string, string>,
): Promise<DeviceBinding | null> {
  const app = new Hono();
  app.get("/probe", async (c) => c.json({ binding: await tryReadDevice(deps, c) }));
  const res = await app.request("/probe", { headers });
  return ((await res.json()) as { binding: DeviceBinding | null }).binding;
}

/**
 * Enrol device A with a cookie and device B as its override target in the same venue.
 */
async function enrolDevDevices(): Promise<{
  cfg: TillConfig;
  deviceAId: string;
  deviceACookie: string;
  deviceBId: string;
}> {
  const { cfg, stationId } = await setupStation();
  // Device A — a `till` device (its profile auto-creates a register), whose cookie stands in for the
  // current identity.
  const tillProfileId = await seedDeviceProfile("Till A profile", "till", []);
  const devA = await enrolDeviceForTest(suite.db, cfg, {
    name: "Till A",
    profileId: tillProfileId,
  });
  // Device B — a `kds` device bound to a station, the override target.
  const kdsProfileId = await seedDeviceProfile("KDS B profile", "kds", []);
  const devB = await enrolDeviceForTest(suite.db, cfg, {
    name: "KDS B",
    profileId: kdsProfileId,
    stationId,
  });
  return {
    cfg,
    deviceAId: devA.deviceId,
    deviceACookie: `${devA.deviceId}.${devA.token}`,
    deviceBId: devB.deviceId,
  };
}

describe("dev-override header (real Postgres)", () => {
  it("is IGNORED when devMode is false (fail-closed) — cookie wins", async () => {
    const { deviceAId, deviceACookie, deviceBId } = await enrolDevDevices();
    const binding = await readWithHeaders(
      { db: suite.db, devMode: false },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    expect(binding?.deviceId).toBe(deviceAId); // NOT deviceBId
  });

  it("is honoured when devMode is true — header wins over cookie, no token needed", async () => {
    const { deviceACookie, deviceBId } = await enrolDevDevices();
    const binding = await readWithHeaders(
      { db: suite.db, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    expect(binding?.deviceId).toBe(deviceBId);
    // Device B is a kds_station; its binding carries the profile's form factor.
    expect(binding?.formFactor).toBe("kds");
  });

  it("an unknown/malformed override id is a miss, with NO cookie fallback", async () => {
    const { deviceACookie } = await enrolDevDevices();
    for (const bad of ["not-a-uuid", randomUUID()]) {
      const binding = await readWithHeaders(
        { db: suite.db, devMode: true },
        { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: bad },
      );
      expect(binding).toBeNull();
    }
  });

  it("with no override header, devMode reads the cookie unchanged", async () => {
    const { deviceAId, deviceACookie } = await enrolDevDevices();
    const binding = await readWithHeaders(
      { db: suite.db, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}` },
    );
    expect(binding?.deviceId).toBe(deviceAId);
  });
});

describe("tryReadDevice dev override resolves a seeded device (real Postgres)", () => {
  // Seeded DIRECTLY (not through the enrol path), so the case is self-contained. The dev-override
  // path carries no token and reads the device by id alone.
  async function seedKdsDeviceUnderNewTenant(): Promise<{ deviceId: string }> {
    const admin = suite.db;
    await seedTenant(admin);
    const [loc] = await admin
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = loc!.id;
    const [st] = await admin
      .insert(kitchenStations)
      .values({ locationId, name: "Cocina", isDefault: true })
      .returning({ id: kitchenStations.id });
    // A kds profile → the binding rule requires a station and no register.
    const [prof] = await admin
      .insert(deviceProfiles)
      .values({ name: "Pantalla", formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    const [dev] = await admin
      .insert(devices)
      .values({
        locationId,
        deviceProfileId: prof!.id,
        stationId: st!.id,
        label: "Pantalla Cocina",
        tokenHash: "scrypt$00$00",
        active: true,
      })
      .returning({ id: devices.id });
    return { deviceId: dev!.id };
  }

  it("DOES resolve a device scoped to its OWN tenant", async () => {
    const { deviceId } = await seedKdsDeviceUnderNewTenant();
    const binding = await readWithHeaders(
      { db: suite.db, devMode: true },
      { [DEV_DEVICE_HEADER]: deviceId },
    );
    expect(binding?.deviceId).toBe(deviceId);
    expect(binding?.formFactor).toBe("kds");
  });
});

describe("requireSaleTillId reading the device cookie itself", () => {
  async function probeSaleTill(
    cookieValue: string | null,
  ): Promise<{ ok: true; tillId: string } | { ok: false; code: string }> {
    const { res, thrown } = await runProbe(cookieValue, async (deps, c) =>
      c.json({ tillId: await requireSaleTillId(deps, c) }),
    );
    if (res.status === 200)
      return { ok: true, tillId: ((await res.json()) as { tillId: string }).tillId };
    return { ok: false, code: isAppError(thrown) ? thrown.code : String(thrown) };
  }

  it("returns the till an enrolled till device's cookie is bound to", async () => {
    const { deviceId, token, tillId } = await enrolTillDeviceFixture();
    expect(await probeSaleTill(`${deviceId}.${token}`)).toEqual({ ok: true, tillId });
  });

  it("refuses a request with no device cookie as device.unauthorized", async () => {
    expect(await probeSaleTill(null)).toEqual({ ok: false, code: "device.unauthorized" });
  });

  it("refuses a kitchen display, which rings no sale, as device.till_required", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    expect(await probeSaleTill(`${deviceId}.${token}`)).toEqual({
      ok: false,
      code: "device.till_required",
    });
  });
});
