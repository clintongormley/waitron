/**
 * The device cookie and the three guards that read it.
 *
 * Every fixture below writes through its TABLE DEFINITION rather than as raw SQL: each table's `id`
 * (and its creation timestamps) is a `$defaultFn` generator raw SQL never reaches, and the table
 * definition is what encodes the JSON and list columns.
 */
import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import { hashSecret } from "@waitron/identity";
import { canvases, deviceProfiles, devices, locations, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { DEFAULT_CANVASES } from "@waitron/layouts";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import type { CapabilityFlag, FormFactor, ProfileAction } from "@waitron/layouts";
import {
  DEV_DEVICE_HEADER,
  DEVICE_COOKIE,
  assertDeviceCapability,
  assertDeviceStillProven,
  assertTakesCash,
  clearDeviceCookie,
  cookieDomainFor,
  readDeviceCookie,
  requireDevice,
  requireDeviceProof,
  setDeviceCookie,
  tryReadDevice,
  VERIFIED_TOKENS_LIMIT,
} from "./device-session.js";
import type { DeviceBinding, DeviceProof } from "./device-session.js";
import "./errors.js";

/**
 * The real token check, counted, with an optional hook that runs after it has decided and before
 * `tryReadDevice` carries on, so a test can commit a change at exactly that point.
 */
const verification = vi.hoisted(() => ({
  calls: 0,
  afterVerify: null as null | (() => Promise<void>),
}));
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...actual,
    verifySecretAsync: async (secret: string, stored: string) => {
      verification.calls += 1;
      const verified = await actual.verifySecretAsync(secret, stored);
      if (verification.afterVerify !== null) await verification.afterVerify();
      return verified;
    },
  };
});
afterEach(() => {
  verification.afterVerify = null;
});

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
  const nodeId = await seedNode(admin, brandLocationId(locationId));
  const cfg: TillConfig = {
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
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

/** What a station screen enrolled without a hardware target carries beyond its identity. */
const NO_BINDINGS = {
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
}> {
  const { cfg } = await setupStation();
  const [canvas] = await suite.db
    .insert(canvases)
    .values({ name: "Front counter", definition: DEFAULT_CANVASES.till })
    .returning({ id: canvases.id });
  const canvasId = canvas!.id;
  // This fixture explicitly grants reader and drawer access. The device binds the canvas SOLELY
  // through this profile.
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
  return { cfg, deviceId: dev.deviceId, token: dev.token, deviceProfileId };
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

/** Run the NON-throwing `tryReadDevice` behind the shared scaffold, returning the binding or `null` it
 * resolves the cookie to — the `probe` shape, but reading the JSON-encoded value instead of catching a
 * throw (a `null` round-trips as `null`). */
async function probeTry(cookieValue: string | null): Promise<DeviceBinding | null> {
  const { res } = await runProbe(cookieValue, async (deps, c) =>
    c.json((await tryReadDevice(deps, c)) ?? null),
  );
  return (await res.json()) as DeviceBinding | null;
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
  const deviceProfileId = await seedDeviceProfile("Waiter", "phone-portrait", [], canvasId);
  const dev = await enrolDeviceForTest(suite.db, cfg, {
    name: "Waiter phone",
    profileId: deviceProfileId,
  });
  return { cfg, deviceId: dev.deviceId, token: dev.token };
}

/** Run `assertDeviceCapability` behind the shared HTTP scaffold: `{ ok: true }` when it passes (no
 * throw), or the thrown code + params when it refuses. */
async function probeCapability(
  cookieValue: string | null,
  capability: ProfileAction,
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

describe("requireDevice (venue database)", () => {
  it("authenticates a valid cookie and touches last_seen_at", async () => {
    const { cfg, deviceId, token, deviceProfileId } = await enrolDeviceFixture();
    expect(await lastSeenAt(deviceId)).toBeNull(); // never seen yet

    const result = await probe(`${deviceId}.${token}`);
    expect(result).toEqual({
      ok: true,
      binding: {
        deviceId,
        formFactor: "kds",
        label: "Pantalla",
        locationId: cfg.locationId,
        deviceProfileId,
        ...NO_BINDINGS,
      },
    });

    expect(await lastSeenAt(deviceId)).not.toBeNull(); // the guard recorded the sighting
  });

  it("carries the device's assigned profile + hardware bindings back on the binding (SP-A.2 §16, device-profile §5)", async () => {
    const { cfg, deviceId, token, deviceProfileId } = await enrolTillDeviceFixture();
    // The canvas is not a device field; it resolves THROUGH the profile at `/api/till`.
    expect(await probe(`${deviceId}.${token}`)).toEqual({
      ok: true,
      binding: {
        deviceId,
        formFactor: "till",
        label: "Counter till",
        locationId: cfg.locationId,
        deviceProfileId,
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

describe("tryReadDevice (venue database)", () => {
  it("tryReadDevice returns the binding for a valid cookie and null at every miss", async () => {
    const { cfg, deviceId, token, deviceProfileId } = await enrolDeviceFixture();
    // Success resolves to the same binding `requireDevice` returns.
    expect(await probeTry(`${deviceId}.${token}`)).toEqual({
      deviceId,
      formFactor: "kds",
      label: "Pantalla",
      locationId: cfg.locationId,
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
});

describe("requireDeviceProof and assertDeviceStillProven (venue database)", () => {
  async function proofFor(headers: Record<string, string>, devMode = false): Promise<DeviceProof> {
    const app = new Hono();
    app.get("/probe", async (c) => c.json(await requireDeviceProof({ db: suite.db, devMode }, c)));
    const res = await app.request("/probe", { headers });
    expect(res.status).toBe(200);
    return (await res.json()) as DeviceProof;
  }

  async function stillProven(proof: DeviceProof): Promise<string> {
    try {
      await withTransaction(suite.db, (tx) => assertDeviceStillProven(tx, proof));
      return "proven";
    } catch (err) {
      return isAppError(err) ? err.code : String(err);
    }
  }

  async function storedHash(deviceId: string): Promise<string> {
    const [row] = await suite.db
      .select({ tokenHash: devices.tokenHash })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return row!.tokenHash;
  }

  it("keeps the stored hash the cookie verified against, and refuses once the device is revoked", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const proof = await proofFor({ cookie: `${DEVICE_COOKIE}=${deviceId}.${token}` });
    expect(proof.device.deviceId).toBe(deviceId);
    expect(proof.tokenHash).toBe(await storedHash(deviceId));
    expect(await stillProven(proof)).toBe("proven");

    await revoke(deviceId);
    expect(await stillProven(proof)).toBe("device.unauthorized");
  });

  it("refuses an active device whose token changed after the proof", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const proof = await proofFor({ cookie: `${DEVICE_COOKIE}=${deviceId}.${token}` });
    await suite.db
      .update(devices)
      .set({ tokenHash: hashSecret("a-newer-token") })
      .where(eq(devices.id, deviceId));
    expect(await stillProven(proof)).toBe("device.unauthorized");
  });

  it("returns the device as it stands now, not as the proof read it", async () => {
    const { cfg, deviceId, token } = await enrolDeviceFixture();
    const proof = await proofFor({ cookie: `${DEVICE_COOKIE}=${deviceId}.${token}` });
    expect(proof.device.formFactor).toBe("kds");
    const tillProfileId = await seedDeviceProfile("Bar tills", "till", ["take-cash"]);
    await suite.db
      .update(devices)
      .set({ deviceProfileId: tillProfileId, label: "Bar till" })
      .where(eq(devices.id, deviceId));

    const current = await withTransaction(suite.db, (tx) => assertDeviceStillProven(tx, proof));
    expect(current).toEqual({
      deviceId,
      formFactor: "till",
      label: "Bar till",
      locationId: cfg.locationId,
      deviceProfileId: tillProfileId,
      capabilities: ["take-cash"],
    });
  });

  it("a dev-header proof carries no hash and is checked again for active alone", async () => {
    const { deviceBId } = await enrolDevDevices();
    const proof = await proofFor({ [DEV_DEVICE_HEADER]: deviceBId }, true);
    expect(proof.tokenHash).toBeNull();
    await suite.db
      .update(devices)
      .set({ tokenHash: hashSecret("a-newer-token") })
      .where(eq(devices.id, deviceBId));
    expect(await stillProven(proof)).toBe("proven");

    await revoke(deviceBId);
    expect(await stillProven(proof)).toBe("device.unauthorized");
  });

  it("requireDeviceProof refuses a wrong token with device.unauthorized", async () => {
    const { deviceId } = await enrolDeviceFixture();
    const { res, thrown } = await runProbe(`${deviceId}.not-the-real-token`, async (deps, c) =>
      c.json(await requireDeviceProof(deps, c)),
    );
    expect(res.status).toBe(500);
    expect(isAppError(thrown) ? thrown.code : thrown).toBe("device.unauthorized");
  });
});

describe("assertDeviceCapability (venue database)", () => {
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
    // No `waitron_device` cookie ⇒ `tryReadDevice` → null ⇒ pass.
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
  // Device A — a `till` device, whose cookie stands in for the current identity.
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

describe("assertTakesCash on a resolved device", () => {
  const binding = (
    capabilities: CapabilityFlag[],
    formFactor: FormFactor = "phone-portrait",
  ): DeviceBinding => ({
    deviceId: randomUUID(),
    formFactor,
    label: "Waiter phone",
    locationId: randomUUID(),
    deviceProfileId: randomUUID(),
    capabilities,
  });

  it("refuses a device whose profile lacks take-cash, and passes one that has it and no device", () => {
    expect(() => assertTakesCash(binding(["open-cash-drawer"]))).toThrow(
      expect.objectContaining({ code: "device.cash_not_allowed" }),
    );
    expect(() => assertTakesCash(binding(["take-cash"]))).not.toThrow();
    expect(() => assertTakesCash(null)).not.toThrow();
  });
});

describe("dev-override header (venue database)", () => {
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

describe("tryReadDevice dev override resolves a seeded device (venue database)", () => {
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
    const [prof] = await admin
      .insert(deviceProfiles)
      .values({ name: "Pantalla", formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    const [dev] = await admin
      .insert(devices)
      .values({
        locationId,
        deviceProfileId: prof!.id,
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

describe("reading the device beside the write lock", () => {
  const setLastSeen = (deviceId: string, at: Date) =>
    suite.db.execute(
      sql`update devices set last_seen_at = ${at.toISOString()} where id = ${deviceId}`,
    );

  /**
   * Holds the venue's write lock open until the returned `release` is called. `during` runs inside
   * the held transaction first, so what it writes commits only on release.
   */
  function holdWriteLock(during?: () => Promise<unknown>): {
    release: () => void;
    done: Promise<void>;
  } {
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = withTransaction(suite.db, async () => {
      await during?.();
      await opened;
    });
    return { release: () => release(), done };
  }

  /** Resolves once a caller has asked `suite.db` for the write lock; `restore` puts it back. */
  function watchLockRequest(): { requested: Promise<void>; restore: () => void } {
    const original = suite.db.withWriteLock;
    let resolve!: () => void;
    const requested = new Promise<void>((done) => {
      resolve = done;
    });
    const spy = vi.spyOn(suite.db, "withWriteLock").mockImplementation((body) => {
      const queued = original(body);
      resolve();
      return queued;
    });
    return { requested, restore: () => spy.mockRestore() };
  }

  /** The read's device id, or "still waiting" if it has not resolved within two seconds. */
  const within = (read: Promise<DeviceBinding | null>) =>
    Promise.race([
      read.then((binding) => binding?.deviceId ?? null),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 2_000)),
    ]);

  it("records a sighting at most once a minute", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const recent = new Date(Date.now() - 30_000);
    await setLastSeen(deviceId, recent);
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    expect(await lastSeenAt(deviceId)).toBe(recent.toISOString());

    const stale = new Date(Date.now() - 90_000);
    await setLastSeen(deviceId, stale);
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    expect(Date.parse((await lastSeenAt(deviceId))!)).toBeGreaterThan(Date.now() - 10_000);
  });

  it("verifies a cookie while another caller holds the write lock, when no sighting is due", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    await setLastSeen(deviceId, new Date());
    const lock = holdWriteLock();
    const read = probeTry(`${deviceId}.${token}`);
    try {
      expect(await within(read)).toBe(deviceId);
    } finally {
      lock.release();
      await lock.done;
      await read;
    }
  });

  it("refuses a revoked device and a wrong token while the write lock is held", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    await setLastSeen(deviceId, new Date());
    const lock = holdWriteLock();
    try {
      expect(await within(probeTry(`${deviceId}.not-the-real-token`))).toBeNull();
    } finally {
      lock.release();
      await lock.done;
    }
    await revoke(deviceId);
    const again = holdWriteLock();
    try {
      expect(await within(probeTry(`${deviceId}.${token}`))).toBeNull();
    } finally {
      again.release();
      await again.done;
    }
  });

  // The change is written inside the held transaction, so the lock-free reads cannot see it; it
  // commits on release, after the read has queued for the lock to record its sighting.
  it.each([
    ["revoked", { active: false }],
    ["re-keyed", { tokenHash: hashSecret("replacement") }],
  ] as const)(
    "refuses a device %s while it waits for the lock to record a sighting",
    async (_label, change) => {
      const { deviceId, token } = await enrolDeviceFixture();
      const stale = new Date(Date.now() - 90_000);
      await setLastSeen(deviceId, stale);
      const lock = holdWriteLock(() =>
        suite.db.update(devices).set(change).where(eq(devices.id, deviceId)),
      );
      const watch = watchLockRequest();
      let read: Promise<DeviceBinding | null> | undefined;
      try {
        read = probeTry(`${deviceId}.${token}`);
        expect(await Promise.race([watch.requested.then(() => "queued"), read])).toBe("queued");
      } finally {
        watch.restore();
        lock.release();
        await lock.done;
      }
      expect(await read).toBeNull();
      expect(await lastSeenAt(deviceId)).toBe(stale.toISOString());
    },
  );

  it("returns the profile the device was moved to while it waits for the lock to record a sighting", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const movedTo = await seedDeviceProfile("Pantalla nueva", "kds", []);
    const stale = new Date(Date.now() - 90_000);
    await setLastSeen(deviceId, stale);
    const lock = holdWriteLock(() =>
      suite.db.update(devices).set({ deviceProfileId: movedTo }).where(eq(devices.id, deviceId)),
    );
    const watch = watchLockRequest();
    let read: Promise<DeviceBinding | null> | undefined;
    try {
      read = probeTry(`${deviceId}.${token}`);
      expect(await Promise.race([watch.requested.then(() => "queued"), read])).toBe("queued");
    } finally {
      watch.restore();
      lock.release();
      await lock.done;
    }
    expect((await read)?.deviceProfileId).toBe(movedTo);
    expect(Date.parse((await lastSeenAt(deviceId))!)).toBeGreaterThan(Date.now() - 10_000);
  });

  it("resolves a dev-override device while another caller holds the write lock", async () => {
    const { deviceACookie, deviceBId } = await enrolDevDevices();
    const lock = holdWriteLock();
    const read = readWithHeaders(
      { db: suite.db, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    try {
      expect(await within(read)).toBe(deviceBId);
    } finally {
      lock.release();
      await lock.done;
      await read;
    }
  });

  it("lets the event loop turn while it verifies the token", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    await setLastSeen(deviceId, new Date());
    const cookie = `${DEVICE_COOKIE}=${deviceId}.${token}`;
    const app = new Hono();
    const order: string[] = [];
    app.get("/probe", async (c) => {
      const read = tryReadDevice({ db: suite.db }, c).then(() => order.push("resolved"));
      setImmediate(() => order.push("turned"));
      await read;
      return c.body(null, 204);
    });
    expect((await app.request("/probe", { headers: { cookie } })).status).toBe(204);
    expect(order).toEqual(["turned", "resolved"]);
  });

  it("writes one sighting when several requests find it due at once", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    await setLastSeen(deviceId, new Date(Date.now() - 90_000));
    await suite.db.execute(sql`create table sighting_writes (n integer)`);
    await suite.db.execute(sql`
      create trigger count_sighting_writes after update of last_seen_at on devices
      begin insert into sighting_writes values (1); end`);
    try {
      // Every read finishes checking its token before any of them goes on.
      const READS = 6;
      let verified = 0;
      let releaseAll!: () => void;
      const allVerified = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });
      verification.afterVerify = async () => {
        if (++verified === READS) releaseAll();
        await allVerified;
      };
      const reads = await Promise.all(
        Array.from({ length: READS }, () => probeTry(`${deviceId}.${token}`)),
      );
      expect(reads.map((binding) => binding?.deviceId)).toEqual(Array(READS).fill(deviceId));
      const { rows } = await suite.db.execute<{ writes: number }>(
        sql`select count(*) as writes from sighting_writes`,
      );
      expect(rows[0]!.writes).toBe(1);
    } finally {
      await suite.db.execute(sql`drop trigger count_sighting_writes`);
      await suite.db.execute(sql`drop table sighting_writes`);
    }
  });
});

describe("a change committed while the token is being verified", () => {
  /** Commits `change` once, after the next token check has decided; `fired` says whether it ran. */
  function commitDuringVerification(change: () => unknown): { fired: () => boolean } {
    let fired = false;
    verification.afterVerify = async () => {
      verification.afterVerify = null;
      await change();
      fired = true;
    };
    return { fired: () => fired };
  }

  it("refuses a device revoked meanwhile", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const hook = commitDuringVerification(() => revoke(deviceId));
    expect(await probeTry(`${deviceId}.${token}`)).toBeNull();
    expect(hook.fired()).toBe(true);
  });

  it("refuses the old token once its hash has been replaced meanwhile", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const hook = commitDuringVerification(() =>
      suite.db.execute(
        sql`update devices set token_hash = ${hashSecret("replacement")} where id = ${deviceId}`,
      ),
    );
    expect(await probeTry(`${deviceId}.${token}`)).toBeNull();
    expect(hook.fired()).toBe(true);
  });

  it("returns the profile the device was moved to meanwhile", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const movedTo = await seedDeviceProfile("Pantalla nueva", "kds", []);
    const hook = commitDuringVerification(() =>
      suite.db.execute(
        sql`update devices set device_profile_id = ${movedTo} where id = ${deviceId}`,
      ),
    );
    expect((await probeTry(`${deviceId}.${token}`))?.deviceProfileId).toBe(movedTo);
    expect(hook.fired()).toBe(true);
  });
});

describe("a token already verified for its device", () => {
  it("is not put through scrypt again", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    const before = verification.calls;
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    expect(verification.calls - before).toBe(1);
  });

  it("is verified afresh, and refused, once the device's token hash is replaced", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    await suite.db.execute(
      sql`update devices set token_hash = ${hashSecret("replacement")} where id = ${deviceId}`,
    );
    const before = verification.calls;
    expect(await probeTry(`${deviceId}.${token}`)).toBeNull();
    expect(verification.calls - before).toBe(1);
    expect(await probeTry(`${deviceId}.replacement`)).not.toBeNull();
  });

  it("does not let a different token through for the same device", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    expect(await probeTry(`${deviceId}.not-the-real-token`)).toBeNull();
  });

  it("is forgotten, oldest first, once more devices than the limit have verified", async () => {
    const { cfg, deviceId, token, deviceProfileId } = await enrolDeviceFixture();
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    // A full memo of other devices sharing its token, each verified after it.
    const [first] = await suite.db
      .select({ tokenHash: devices.tokenHash })
      .from(devices)
      .where(eq(devices.id, deviceId));
    const others = await suite.db
      .insert(devices)
      .values(
        Array.from({ length: VERIFIED_TOKENS_LIMIT }, (_, i) => ({
          locationId: cfg.locationId,
          deviceProfileId,
          label: `Pantalla ${i}`,
          tokenHash: first!.tokenHash,
        })),
      )
      .returning({ id: devices.id });
    const readAll = () => Promise.all(others.map(({ id }) => probeTry(`${id}.${token}`)));
    let before = verification.calls;
    expect((await readAll()).every((binding) => binding !== null)).toBe(true);
    expect(verification.calls - before).toBe(VERIFIED_TOKENS_LIMIT);

    before = verification.calls;
    expect((await readAll()).every((binding) => binding !== null)).toBe(true);
    expect(verification.calls - before).toBe(0);
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    expect(verification.calls - before).toBe(1);
  });

  it("is refused once the device is revoked", async () => {
    const { deviceId, token } = await enrolDeviceFixture();
    expect(await probeTry(`${deviceId}.${token}`)).not.toBeNull();
    await revoke(deviceId);
    expect(await probeTry(`${deviceId}.${token}`)).toBeNull();
  });
});
