import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import {
  DEVICE_COOKIE,
  assertNotHandheld,
  clearDeviceCookie,
  readDeviceCookie,
  requireDevice,
  setDeviceCookie,
  tryReadDevice,
} from "./device-session.js";
import type { DeviceBinding } from "./device-session.js";
import "./errors.js";

// Real Postgres, not PGlite — MANDATORY for `requireDevice` (CLAUDE.md §4). The guard is DB VALIDATION
// under the deployment role: it fetches the device as `app_user` inside `withTenant`, so tenant
// isolation (RLS) and the `active = true` revocation filter are the properties under test, and PGlite
// — every connection a superuser that bypasses RLS — is a FALSE pass for exactly those. The cookie
// helpers below need no database; they ride the same shared clone rather than a second file.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

function asApp<T>(db: Database, cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** A fresh tenant + venue + one station, seeded on the superuser admin connection (RLS bypassed for
 * setup), the station created through the app role — the `device.rls.test.ts` shape. Each test gets
 * its OWN tenant so device state is order-independent across the shared clone (CLAUDE.md §4). */
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

/** Flip `active = false` on the superuser connection — the revocation a `device.manage` route performs.
 * Run as the admin (RLS bypassed) for pure test setup, the `device.test.ts` `expirePairingCodes` shape. */
async function revoke(deviceId: string): Promise<void> {
  await suite.admin.execute(sql`update devices set active = false where id = ${deviceId}`);
}

/** Read `last_seen_at` on the admin connection (RLS bypassed) — NULL until `requireDevice` first
 * touches it. The differential proof that a successful guard call records the sighting. */
async function lastSeenAt(deviceId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ last_seen_at: string | null }>(
    sql`select last_seen_at from devices where id = ${deviceId}`,
  );
  return rows[0]!.last_seen_at;
}

type ProbeResult =
  | { ok: true; binding: { deviceId: string; kind: string; stationId: string | null } }
  | { ok: false; code: string };

/** Run `requireDevice` behind a one-route Hono app carrying the given cookie value (or none), the
 * `management-session.test.ts` shape. Returns the binding on success or the thrown code on failure. */
async function probe(cfg: TillConfig, cookieValue: string | null): Promise<ProbeResult> {
  const app = new Hono();
  const deps = { db: suite.admin, cfg: { tenantId: cfg.tenantId } };
  let thrown: unknown;
  app.get("/probe", async (c) => c.json(await requireDevice(deps, c)));
  app.onError((err, c) => {
    thrown = err;
    return c.body(null, 500);
  });
  const res = await app.request(
    "/probe",
    cookieValue === null ? undefined : { headers: { cookie: `${DEVICE_COOKIE}=${cookieValue}` } },
  );
  if (res.status === 200) {
    return {
      ok: true,
      binding: (await res.json()) as { deviceId: string; kind: string; stationId: string | null },
    };
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
    generatePairingCode(tx, cfg, { kind: "handheld", stationId: null, label: "Waiter phone" }),
  );
  const dev = await asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code }));
  return { cfg, deviceId: dev.deviceId, token: dev.token };
}

/** Run the NON-throwing `tryReadDevice` behind a one-route app, returning the binding or `null` it
 * resolves the cookie to — the `probe` shape, but reading the value instead of catching a throw. */
async function probeTry(
  cfg: TillConfig,
  cookieValue: string | null,
): Promise<DeviceBinding | null> {
  const app = new Hono();
  const deps = { db: suite.admin, cfg: { tenantId: cfg.tenantId } };
  let out: DeviceBinding | null = null;
  app.get("/probe", async (c) => {
    out = await tryReadDevice(deps, c);
    return c.body(null, 204);
  });
  await app.request(
    "/probe",
    cookieValue === null ? undefined : { headers: { cookie: `${DEVICE_COOKIE}=${cookieValue}` } },
  );
  return out;
}

/** Run `assertNotHandheld` behind a one-route app: `{ ok: true }` when it passes (no throw), or the
 * thrown code when it refuses. */
async function probeAssert(
  cfg: TillConfig,
  cookieValue: string | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const app = new Hono();
  const deps = { db: suite.admin, cfg: { tenantId: cfg.tenantId } };
  let thrown: unknown;
  app.get("/probe", async (c) => {
    await assertNotHandheld(deps, c, "record_sale");
    return c.body(null, 204);
  });
  app.onError((err, c) => {
    thrown = err;
    return c.body(null, 500);
  });
  const res = await app.request(
    "/probe",
    cookieValue === null ? undefined : { headers: { cookie: `${DEVICE_COOKIE}=${cookieValue}` } },
  );
  if (res.status === 204) return { ok: true };
  return { ok: false, code: isAppError(thrown) ? thrown.code : String(thrown) };
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
    expect(result).toEqual({ ok: true, binding: { deviceId, kind: "kds_station", stationId } });

    expect(await lastSeenAt(deviceId)).not.toBeNull(); // the guard recorded the sighting
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
