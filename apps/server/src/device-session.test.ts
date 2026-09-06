import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
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
import { enrolDevice, generatePairingCode } from "./device.js";
import type { CapabilityFlag } from "@waitron/layouts";
import {
  DEV_DEVICE_HEADER,
  DEVICE_COOKIE,
  assertDeviceCapability,
  assertNotHandheld,
  clearDeviceCookie,
  cookieDomainFor,
  readDeviceCookie,
  requireDevice,
  setDeviceCookie,
  tryReadDevice,
} from "./device-session.js";
import type { DeviceBinding } from "./device-session.js";
import "./errors.js";

// Real PostgreSQL checks requireDevice reads and last_seen_at writes under app_user privileges;
// a check left on PGlite's default superuser would pass without those grants.
// Cookie-only checks share the same file fixture.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

function asApp<T>(db: Database, cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/**
 * Each database-backed test seeds its own venue, keeping device state order-independent
 * across the shared clone; stations are created through the app role.
 */
async function setupStation(): Promise<{ cfg: TillConfig; stationId: string }> {
  const admin = suite.admin;
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(admin, tenantId, brandLocationId(locationId));
  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const st = await asApp(admin, cfg, (tx) =>
    createStation(tx, cfg, { name: "Cocina", isDefault: true }),
  );
  return { cfg, stationId: st.id };
}

/** Enrol a REAL device via Task 3's `enrolDevice` — the only way to obtain a `${deviceId}.${token}`
 * whose scrypt hash actually verifies. Returns the plaintext token the enrol route would set in the
 * cookie, never at rest. */
async function enrolDeviceFixture(): Promise<{
  cfg: TillConfig;
  deviceId: string;
  token: string;
  stationId: string;
}> {
  const { cfg, stationId } = await setupStation();
  const { code } = await asApp(suite.admin, cfg, (tx) =>
    generatePairingCode(tx, cfg, { kind: "kds_station", stationId, label: "Pantalla" }),
  );
  const dev = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code }));
  return { cfg, deviceId: dev.deviceId, token: dev.token, stationId };
}

/** The canvas/till/hardware bindings a device enrolled with NONE assigned surfaces — every binding is
 * the column default. A `kds_station` (like `enrolDeviceFixture`'s) binds no till, no canvas and no
 * hardware, so `tryReadDevice` carries these back verbatim. Spread into the expected binding so the new
 * SP-A.2 fields are pinned alongside the pre-existing `deviceId`/`kind`/`stationId`. */
const NO_BINDINGS = {
  tillId: null,
  deviceProfileId: null,
  receiptPrinterId: null,
  hasCashDrawer: false,
  cardProvider: "none",
  cardReaderId: null,
} as const;

/**
 * Insert a device profile for the capability checks. canvasId is optional.
 */
async function seedDeviceProfile(
  cfg: TillConfig,
  name: string,
  capabilities: CapabilityFlag[],
  canvasId: string | null = null,
): Promise<string> {
  const prof = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, canvas_id, capabilities)
    values (${cfg.tenantId}, ${name}, ${canvasId}::uuid, ${JSON.stringify(capabilities)}::jsonb)
    returning id`);
  return prof.rows[0]!.id;
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
  const prof = await suite.admin.execute<{ id: string }>(sql`
    insert into canvases (tenant_id, name, definition)
    values (${cfg.tenantId}, 'Front counter', ${JSON.stringify(DEFAULT_CANVASES.till)}::jsonb)
    returning id`);
  const canvasId = prof.rows[0]!.id;
  // The device profile carries the capabilities the firewall now reads (Task 9): both fenced flags, the
  // values `DEFAULT_PROFILE_CAPABILITIES.till` seeds. Its canvas reference is the front-counter canvas —
  // the device binds that canvas SOLELY through this profile (the direct device→canvas link was dropped
  // in the Task 10 cutover).
  const deviceProfileId = await seedDeviceProfile(
    cfg,
    "Counter",
    ["integrated-card-payment", "open-cash-drawer"],
    canvasId,
  );
  const { code } = await asApp(suite.admin, cfg, (tx) =>
    // A `till` is sale-capable, so it REQUIRES a till_id (SP-A.2 §16.4) — the seeded till. It also
    // carries the device profile and the hardware trio (cash drawer + reader).
    generatePairingCode(tx, cfg, {
      kind: "till",
      stationId: null,
      tillId: cfg.tillId,
      deviceProfileId,
      hasCashDrawer: true,
      cardProvider: "stripe_terminal",
      cardReaderId: "reader_ABC",
      label: "Counter till",
    }),
  );
  const dev = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code }));
  return { cfg, deviceId: dev.deviceId, token: dev.token, deviceProfileId };
}

/**
 * Deactivate the device on the admin connection for the revocation test.
 */
async function revoke(deviceId: string): Promise<void> {
  await suite.admin.execute(sql`update devices set active = false where id = ${deviceId}`);
}

/**
 * Read last_seen_at to compare the value before and after device validation.
 */
async function lastSeenAt(deviceId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ last_seen_at: string | null }>(
    sql`select last_seen_at from devices where id = ${deviceId}`,
  );
  return rows[0]!.last_seen_at;
}

type ProbeResult = { ok: true; binding: DeviceBinding } | { ok: false; code: string };

/**
 * The shared one-route scaffold every guard probe runs behind (the `management-session.test.ts`
 * shape): a fresh Hono app whose sole `GET /probe` runs `handler` with the guard's `deps` + the request
 * `Context`, carrying the given cookie value (or none), with an `onError` that captures any throw. The
 * three probes below differ only in which guard they call and how they read the outcome — they supply
 * `handler` and interpret `{ res, thrown }`; the setup lives here once.
 */
async function runProbe(
  cfg: TillConfig,
  cookieValue: string | null,
  handler: (deps: { db: Database; cfg: { tenantId: string } }, c: Context) => Promise<Response>,
): Promise<{ res: Response; thrown: unknown }> {
  const app = new Hono();
  const deps = { db: suite.admin, cfg: { tenantId: cfg.tenantId } };
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
async function probe(cfg: TillConfig, cookieValue: string | null): Promise<ProbeResult> {
  const { res, thrown } = await runProbe(cfg, cookieValue, async (deps, c) =>
    c.json(await requireDevice(deps, c)),
  );
  if (res.status === 200) {
    return { ok: true, binding: (await res.json()) as DeviceBinding };
  }
  return { ok: false, code: isAppError(thrown) ? thrown.code : String(thrown) };
}

/** Enrol a REAL handheld device — no station (`kindRequiresStation("handheld")` is false, Task 2) — so
 * `tryReadDevice` resolves its cookie to a `handheld` binding. Same enrol path as `enrolDeviceFixture`,
 * with the order-only kind. */
async function enrolHandheldFixture(): Promise<{
  cfg: TillConfig;
  deviceId: string;
  token: string;
}> {
  const { cfg } = await setupStation();
  const { code } = await asApp(suite.admin, cfg, (tx) =>
    // A handheld is sale-capable, so it REQUIRES a till_id (SP-A.2 §16.4) — the seeded till.
    generatePairingCode(tx, cfg, {
      kind: "handheld",
      stationId: null,
      tillId: cfg.tillId,
      label: "Waiter phone",
    }),
  );
  const dev = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code }));
  return { cfg, deviceId: dev.deviceId, token: dev.token };
}

/** Run the NON-throwing `tryReadDevice` behind the shared scaffold, returning the binding or `null` it
 * resolves the cookie to — the `probe` shape, but reading the JSON-encoded value instead of catching a
 * throw (a `null` round-trips as `null`). */
async function probeTry(
  cfg: TillConfig,
  cookieValue: string | null,
): Promise<DeviceBinding | null> {
  const { res } = await runProbe(cfg, cookieValue, async (deps, c) =>
    c.json((await tryReadDevice(deps, c)) ?? null),
  );
  return (await res.json()) as DeviceBinding | null;
}

/** Run `assertNotHandheld` behind the shared HTTP scaffold: `{ ok: true }` when it passes (no throw), or
 * the thrown code when it refuses. The one firewall guard left after the tender-split was removed, so the
 * scaffold is inlined here rather than factored across probes. */
async function probeAssert(
  cfg: TillConfig,
  cookieValue: string | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const { res, thrown } = await runProbe(cfg, cookieValue, async (deps, c) => {
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
  const prof = await suite.admin.execute<{ id: string }>(sql`
    insert into canvases (tenant_id, name, definition)
    values (${cfg.tenantId}, 'Waiter phone', ${JSON.stringify(DEFAULT_CANVASES["phone-portrait"])}::jsonb)
    returning id`);
  const canvasId = prof.rows[0]!.id;
  // The profile declares NO capabilities — the render/firewall source of truth after the Task 9 cutover.
  const deviceProfileId = await seedDeviceProfile(cfg, "Waiter", [], canvasId);
  const { code } = await asApp(suite.admin, cfg, (tx) =>
    // A handheld is sale-capable, so it REQUIRES a till_id (SP-A.2 §16.4) — the seeded till. It carries
    // a profile that references the phone-portrait canvas and whose `capabilities: []` grant neither
    // fenced flag (the canvas binds through the profile since the Task 10 cutover).
    generatePairingCode(tx, cfg, {
      kind: "handheld",
      stationId: null,
      tillId: cfg.tillId,
      deviceProfileId,
      label: "Waiter phone",
    }),
  );
  const dev = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code }));
  return { cfg, deviceId: dev.deviceId, token: dev.token };
}

/** Run `assertDeviceCapability` behind the shared HTTP scaffold: `{ ok: true }` when it passes (no
 * throw), or the thrown code + params when it refuses. */
async function probeCapability(
  cfg: TillConfig,
  cookieValue: string | null,
  capability: CapabilityFlag,
  action: string,
): Promise<{ ok: true } | { ok: false; code: string; params: unknown }> {
  const { res, thrown } = await runProbe(cfg, cookieValue, async (deps, c) => {
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
    // 60*60*24*365 — a full year, so a kitchen screen stays enrolled across reboots (§3c). The
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

  // The optional `domain` (till-reroute §3.5): present ⇒ the cookie carries `Domain=<it>` so the same
  // credential rides to every one of the venue's servers; absent ⇒ host-only (no `Domain` attribute).
  it("setDeviceCookie writes Domain only when a domain is passed", async () => {
    const app = new Hono();
    app.get("/scoped", (c) => {
      setDeviceCookie(c, COOKIE_VALUE, true, "deli.waitron.app");
      return c.body(null, 204);
    });
    app.get("/host-only", (c) => {
      setDeviceCookie(c, COOKIE_VALUE, true);
      return c.body(null, 204);
    });
    const scoped = (await (await app.request("/scoped")).headers.get("set-cookie")) ?? "";
    expect(scoped).toMatch(/Domain=deli\.waitron\.app/i);
    const hostOnly = (await (await app.request("/host-only")).headers.get("set-cookie")) ?? "";
    expect(hostOnly).not.toMatch(/Domain=/i);
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

  // The clearing Set-Cookie must carry the SAME `Domain` the set one did, or the browser keeps the
  // domain-scoped cookie alongside the host-only expiry (the `Path` reasoning, applied to `Domain`).
  it("clearDeviceCookie writes Domain only when a domain is passed", async () => {
    const app = new Hono();
    app.get("/clear", (c) => {
      clearDeviceCookie(c, "deli.waitron.app");
      return c.body(null, 204);
    });
    const res = await app.request("/clear");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/Domain=deli\.waitron\.app/i);
    expect(cookie).toMatch(/Max-Age=0/i);
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
    const { cfg, deviceId, token, stationId } = await enrolDeviceFixture();
    expect(await lastSeenAt(deviceId)).toBeNull(); // never seen yet

    const result = await probe(cfg, `${deviceId}.${token}`);
    expect(result).toEqual({
      ok: true,
      binding: { deviceId, kind: "kds_station", stationId, ...NO_BINDINGS },
    });

    expect(await lastSeenAt(deviceId)).not.toBeNull(); // the guard recorded the sighting
  });

  it("carries the device's assigned profile + till + hardware bindings back on the binding (SP-A.2 §16, device-profile §5)", async () => {
    const { cfg, deviceId, token, deviceProfileId } = await enrolTillDeviceFixture();
    // A `till` device with a NON-NULL profile, till and hardware binding surfaces every column
    // verbatim — the fields the boot reads (`/api/device/me`, `/api/till`) later echo. The canvas is no
    // longer a device field; it resolves THROUGH the profile at `/api/till` (Task 10 cutover).
    expect(await probe(cfg, `${deviceId}.${token}`)).toEqual({
      ok: true,
      binding: {
        deviceId,
        kind: "till",
        stationId: null,
        tillId: cfg.tillId,
        deviceProfileId,
        receiptPrinterId: null,
        hasCashDrawer: true,
        cardProvider: "stripe_terminal",
        cardReaderId: "reader_ABC",
      },
    });
  });

  it("rejects a WRONG token with device.unauthorized and does not touch last_seen_at", async () => {
    const { cfg, deviceId } = await enrolDeviceFixture();
    const result = await probe(cfg, `${deviceId}.not-the-real-token`);
    expect(result).toEqual({ ok: false, code: "device.unauthorized" });
    // A failed authentication is a no-op on the row: the sighting is recorded only after verify.
    expect(await lastSeenAt(deviceId)).toBeNull();
  });

  it("rejects a MALFORMED cookie (no dot, empty part, non-uuid selector, absent) with device.unauthorized", async () => {
    const { cfg } = await enrolDeviceFixture();
    for (const bad of [
      "no-dot-here", // no separator
      "", // empty
      ".tokenonly", // empty selector
      "11111111-1111-4111-8111-111111111111.", // empty token
      "not-a-uuid.sometoken", // non-uuid selector
    ]) {
      expect(await probe(cfg, bad)).toEqual({ ok: false, code: "device.unauthorized" });
    }
    expect(await probe(cfg, null)).toEqual({ ok: false, code: "device.unauthorized" });
  });

  it("rejects an UNKNOWN device id with device.unauthorized", async () => {
    const { cfg, token } = await enrolDeviceFixture();
    const result = await probe(cfg, `${randomUUID()}.${token}`);
    expect(result).toEqual({ ok: false, code: "device.unauthorized" });
  });

  it("rejects a REVOKED device (active = false) with device.unauthorized — instant revocation", async () => {
    const { cfg, deviceId, token } = await enrolDeviceFixture();
    // It authenticates while active…
    expect((await probe(cfg, `${deviceId}.${token}`)).ok).toBe(true);
    // …and stops the instant it is revoked, with no token TTL to wait out. This is the differential
    // proof of the `active = true` filter (proven by deletion in the task-4 report).
    await revoke(deviceId);
    const result = await probe(cfg, `${deviceId}.${token}`);
    expect(result).toEqual({ ok: false, code: "device.unauthorized" });
  });
});

describe("tryReadDevice and assertNotHandheld (real Postgres)", () => {
  it("tryReadDevice returns the binding for a valid cookie and null at every miss", async () => {
    const { cfg, deviceId, token, stationId } = await enrolDeviceFixture();
    // Success resolves to the same binding `requireDevice` returns.
    expect(await probeTry(cfg, `${deviceId}.${token}`)).toEqual({
      deviceId,
      kind: "kds_station",
      stationId,
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
      expect(await probeTry(cfg, bad)).toBeNull();
    }
    expect(await probeTry(cfg, null)).toBeNull(); // absent cookie
  });

  it("assertNotHandheld refuses an ACTIVE handheld with device.forbidden_action", async () => {
    const { cfg, deviceId, token } = await enrolHandheldFixture();
    expect(await probeAssert(cfg, `${deviceId}.${token}`)).toEqual({
      ok: false,
      code: "device.forbidden_action",
    });
  });

  it("assertNotHandheld passes a non-handheld device, an absent cookie, and a failed device cookie", async () => {
    const { cfg, deviceId, token } = await enrolDeviceFixture();
    // A kds_station device is not order-only — it never posts to a sale route, and the firewall does
    // not block it here.
    expect(await probeAssert(cfg, `${deviceId}.${token}`)).toEqual({ ok: true });
    // An ordinary till carries NO device cookie: `tryReadDevice` → null → the firewall passes.
    expect(await probeAssert(cfg, null)).toEqual({ ok: true });
    // A malformed/unauthenticated device cookie is a miss (null), not a handheld, so it passes too —
    // the order-only rule blocks ONLY a verified handheld, never a non-device caller.
    expect(await probeAssert(cfg, "not-a-uuid.sometoken")).toEqual({ ok: true });
  });
});

describe("assertDeviceCapability (real Postgres)", () => {
  it("refuses a device whose assigned PROFILE LACKS the capability, naming the action", async () => {
    // The handheld's profile carries `capabilities: []` — it lacks BOTH fenced flags. Prove-by-
    // deletion: drop the `!profile.capabilities.includes(...)` check in `assertDeviceCapability` and
    // these pass.
    const { cfg, deviceId, token } = await enrolHandheldWithCanvasFixture();
    expect(
      await probeCapability(cfg, `${deviceId}.${token}`, "integrated-card-payment", "pay"),
    ).toEqual({ ok: false, code: "device.forbidden_action", params: { action: "pay" } });
    expect(
      await probeCapability(cfg, `${deviceId}.${token}`, "open-cash-drawer", "drawer_open"),
    ).toEqual({ ok: false, code: "device.forbidden_action", params: { action: "drawer_open" } });
  });

  it("passes a device whose assigned PROFILE HAS the capability", async () => {
    // The `till` fixture's profile declares BOTH flags (DEFAULT_PROFILE_CAPABILITIES.till).
    const { cfg, deviceId, token } = await enrolTillDeviceFixture();
    expect(
      await probeCapability(cfg, `${deviceId}.${token}`, "integrated-card-payment", "pay"),
    ).toEqual({ ok: true });
    expect(
      await probeCapability(cfg, `${deviceId}.${token}`, "open-cash-drawer", "drawer_open"),
    ).toEqual({ ok: true });
  });

  it("refuses a device with NO assigned device profile (deviceProfileId null) — fail-closed", async () => {
    // A kds_station enrolled with no profile assigned declares no capabilities at all → refused before
    // any profile read. Prove-by-deletion: drop the `deviceProfileId === null` guard and this throws
    // elsewhere instead of the clean 403.
    const { cfg, deviceId, token } = await enrolDeviceFixture();
    expect(
      await probeCapability(cfg, `${deviceId}.${token}`, "integrated-card-payment", "pay"),
    ).toEqual({ ok: false, code: "device.forbidden_action", params: { action: "pay" } });
  });

  it("passes when there is NO device cookie (an env-configured / legacy till)", async () => {
    // No `waitron_device` cookie ⇒ `tryReadDevice` → null ⇒ pass, exactly as `assertNotHandheld`.
    // Nothing blocks a sale on a cookie-less till (CLAUDE.md §5). Prove-by-deletion: drop the
    // `device === null` early return and this throws instead of passing.
    const { cfg } = await enrolDeviceFixture();
    expect(await probeCapability(cfg, null, "integrated-card-payment", "pay")).toEqual({
      ok: true,
    });
    expect(await probeCapability(cfg, null, "open-cash-drawer", "drawer_open")).toEqual({
      ok: true,
    });
  });

  it("preserves the handheld firewall: a handheld (profile caps []) is still blocked from pay + drawer", async () => {
    // The behaviour `assertNotHandheld` enforced by KIND is now enforced by CAPABILITY: a handheld's
    // capability-less profile carries neither flag, so pay and drawer are refused exactly as before —
    // but via the capability, not the device kind.
    const { cfg, deviceId, token } = await enrolHandheldWithCanvasFixture();
    expect(
      (await probeCapability(cfg, `${deviceId}.${token}`, "integrated-card-payment", "pay")).ok,
    ).toBe(false);
    expect(
      (await probeCapability(cfg, `${deviceId}.${token}`, "open-cash-drawer", "drawer_open")).ok,
    ).toBe(false);
  });
});

/**
 * Runs `tryReadDevice` inside a one-route Hono app, passing an optional dev-override header and/or
 * cookie. Mirrors the file's existing `runProbe`/`probeTry` helper but exposes an arbitrary header set
 * (the `probe` helpers only carry a cookie), so the SP-C override header can be driven directly.
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
  // Device A — a `till` device (needs a till_id), whose cookie stands in for the current identity.
  const { code: codeA } = await asApp(suite.admin, cfg, (tx) =>
    generatePairingCode(tx, cfg, {
      kind: "till",
      stationId: null,
      tillId: cfg.tillId,
      label: "Till A",
    }),
  );
  const devA = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code: codeA }));
  // Device B — a `kds_station` (needs a station), the override target.
  const { code: codeB } = await asApp(suite.admin, cfg, (tx) =>
    generatePairingCode(tx, cfg, { kind: "kds_station", stationId, label: "KDS B" }),
  );
  const devB = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code: codeB }));
  return {
    cfg,
    deviceAId: devA.deviceId,
    deviceACookie: `${devA.deviceId}.${devA.token}`,
    deviceBId: devB.deviceId,
  };
}

describe("dev-override header (real Postgres)", () => {
  it("is IGNORED when devMode is false (fail-closed) — cookie wins", async () => {
    const { cfg, deviceAId, deviceACookie, deviceBId } = await enrolDevDevices();
    const binding = await readWithHeaders(
      { db: suite.admin, cfg: { tenantId: cfg.tenantId }, devMode: false },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    expect(binding?.deviceId).toBe(deviceAId); // NOT deviceBId
  });

  it("is honoured when devMode is true — header wins over cookie, no token needed", async () => {
    const { cfg, deviceACookie, deviceBId } = await enrolDevDevices();
    const binding = await readWithHeaders(
      { db: suite.admin, cfg: { tenantId: cfg.tenantId }, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    expect(binding?.deviceId).toBe(deviceBId);
    expect(binding?.kind).toBe("kds_station");
  });

  it("an unknown/malformed override id is a miss, with NO cookie fallback", async () => {
    const { cfg, deviceACookie } = await enrolDevDevices();
    for (const bad of ["not-a-uuid", randomUUID()]) {
      const binding = await readWithHeaders(
        { db: suite.admin, cfg: { tenantId: cfg.tenantId }, devMode: true },
        { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: bad },
      );
      expect(binding).toBeNull();
    }
  });

  it("with no override header, devMode reads the cookie unchanged", async () => {
    const { cfg, deviceAId, deviceACookie } = await enrolDevDevices();
    const binding = await readWithHeaders(
      { db: suite.admin, cfg: { tenantId: cfg.tenantId }, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}` },
    );
    expect(binding?.deviceId).toBe(deviceAId);
  });
});
