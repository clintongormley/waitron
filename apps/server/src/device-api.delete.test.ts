/** The device delete routes, end to end over `app.request`. */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, devices, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, hashSessionToken, loginWithPin, persons, sessions } from "@waitron/identity";
import { payments } from "@waitron/payments";
import type { DeleteImpact } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { parkOrder } from "./working-order.js";
import { mountDeviceApi } from "./device-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { acceptDeviceJoinRequest } from "./join-requests.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

function mountApp(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.db, cfg, secureCookies: false, pairingMode }, noopLog);
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined && opts.cookie !== null) headers["cookie"] = opts.cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

function deviceCookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  return setCookie!.split(";")[0]!;
}

let profileCounter = 0;
async function seedProfile(): Promise<string> {
  profileCounter += 1;
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Test profile ${profileCounter}`,
      formFactor: "till",
      capabilities: [...BASIC_ACTIONS],
    })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** Knock through the real route with an open window, then accept through the verb. */
async function enrol(
  app: Hono,
  venue: Venue,
  pairingMode: PairingMode,
  name = "Barra",
): Promise<{ deviceId: string; jar: string }> {
  const profileId = await seedProfile();
  const hold = pairingMode.open();
  const res = await send(app, "POST", "/api/device/join", { body: { name } });
  expect(res.status).toBe(200);
  const knock = (await res.json()) as { joinId: string };
  const accepted = await withTransaction(suite.db, (tx) =>
    acceptDeviceJoinRequest(tx, venue.cfg, knock.joinId, { label: name, profileId }),
  );
  pairingMode.release(hold.holdId);
  return { deviceId: accepted.deviceId, jar: deviceCookieFrom(res) };
}

async function openTillSession(deviceId: string): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: `Server ${randomUUID()}`, pinHash: hashPin("4321"), role: "staff" })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }),
  );
  return `${SESSION_COOKIE}=${session.token}`;
}

async function paymentInProgress(venue: Venue, deviceId: string): Promise<void> {
  const orderId = randomUUID();
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([{ productId: venue.cafeId, quantity: "1" }]),
    label: "Mesa 1",
  });
  await suite.db.insert(payments).values({
    workingOrderId: orderId,
    source: "device",
    deviceId,
    provider: "stripe",
    paymentRef: randomUUID(),
    amount: 150,
    state: "attempting",
  });
}

async function deviceRow(deviceId: string) {
  const [row] = await suite.db.select().from(devices).where(eq(devices.id, deviceId));
  return row!;
}

async function openSessionCount(deviceId: string): Promise<number> {
  const rows = await suite.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.endedAt)));
  return rows.length;
}

/** Every table's rows, sorted, so two snapshots compare by value. */
async function snapshot(): Promise<Record<string, string[]>> {
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const out: Record<string, string[]> = {};
  for (const { name } of tables.rows) {
    const rows = (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows;
    out[name] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

const impactPath = (id: string) => `/management-api/devices/${id}/delete-impact`;
const devicePath = (id: string) => `/management-api/devices/${id}`;

describe("device delete routes", () => {
  it("device.manage gates both routes: 401 with no session, 403 for staff, 200 for a manager, and the gate is the file's own", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId } = await enrol(app, venue, mode);
    await openTillSession(deviceId);

    for (const [method, path] of [
      ["GET", impactPath(deviceId)],
      ["DELETE", devicePath(deviceId)],
    ] as const) {
      const anonymous = await send(app, method, path, { cookie: null });
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({
        error: { code: "management_session.required" },
      });
      const staff = await send(app, method, path, { cookie: venue.staffCookie });
      expect(staff.status).toBe(403);
      expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
    const row = await deviceRow(deviceId);
    expect(row.active).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect(await openSessionCount(deviceId)).toBe(1);

    const read = await send(app, "GET", impactPath(deviceId), { cookie: venue.managerCookie });
    expect(read.status).toBe(200);
    const deleted = await send(app, "DELETE", devicePath(deviceId), {
      cookie: venue.managerCookie,
    });
    expect(deleted.status).toBe(200);
    expect((await deviceRow(deviceId)).deletedAt).not.toBeNull();
  });

  it("a malformed id answers 404 device.not_found, after the permission check", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const [method, path] of [
      ["GET", impactPath("not-a-uuid")],
      ["DELETE", devicePath("not-a-uuid")],
    ] as const) {
      const staff = await send(app, method, path, { cookie: venue.staffCookie });
      expect(staff.status).toBe(403);
      expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
      const manager = await send(app, method, path, { cookie: venue.managerCookie });
      expect(manager.status).toBe(404);
      expect(await manager.json()).toMatchObject({ error: { code: "device.not_found" } });
    }
  });

  it("reads the impact, then deletes with it recomputed, and a second delete answers device.not_found and writes nothing", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId } = await enrol(app, venue, mode, "Terraza");
    await openTillSession(deviceId);

    const read = await send(app, "GET", impactPath(deviceId), { cookie: venue.managerCookie });
    expect(read.status).toBe(200);
    const before = (await read.json()) as DeleteImpact;
    expect(before).toEqual({
      target: { id: deviceId, name: "Terraza" },
      refusals: [],
      ends: [{ key: "sessions", count: 1, targets: [] }],
      removes: [],
    });

    await openTillSession(deviceId);
    const res = await send(app, "DELETE", devicePath(deviceId), { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...before,
      ends: [{ key: "sessions", count: 2, targets: [] }],
    });
    expect(await openSessionCount(deviceId)).toBe(0);

    const state = await snapshot();
    const again = await send(app, "DELETE", devicePath(deviceId), { cookie: venue.managerCookie });
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: { code: "device.not_found" } });
    const reread = await send(app, "GET", impactPath(deviceId), { cookie: venue.managerCookie });
    expect(reread.status).toBe(404);
    expect(await reread.json()).toMatchObject({ error: { code: "device.not_found" } });
    expect(await snapshot()).toEqual(state);
  });

  it("a refusal created between the read and the delete makes the delete answer 409 device.payment_in_progress", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId } = await enrol(app, venue, mode);
    await openTillSession(deviceId);

    const read = await send(app, "GET", impactPath(deviceId), { cookie: venue.managerCookie });
    expect(((await read.json()) as DeleteImpact).refusals).toEqual([]);

    await paymentInProgress(venue, deviceId);
    const res = await send(app, "DELETE", devicePath(deviceId), { cookie: venue.managerCookie });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "device.payment_in_progress" } });
    const row = await deviceRow(deviceId);
    expect(row.active).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect(await openSessionCount(deviceId)).toBe(1);
  });

  it("after the delete, the device's cookie is refused and its sign-in cookie is refused", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId, jar } = await enrol(app, venue, mode);
    const shift = await openTillSession(deviceId);

    expect((await send(app, "GET", "/api/device/me", { cookie: jar })).status).toBe(200);
    const profileId = (await deviceRow(deviceId)).deviceProfileId;
    const switched = await send(app, "POST", "/api/device/active-profile", {
      cookie: shift,
      body: { profileId },
    });
    expect(switched.status).toBe(200);

    const res = await send(app, "DELETE", devicePath(deviceId), { cookie: venue.managerCookie });
    expect(res.status).toBe(200);

    const me = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    const afterSwitch = await send(app, "POST", "/api/device/active-profile", {
      cookie: shift,
      body: { profileId },
    });
    expect(afterSwitch.status).toBe(401);
    expect(await afterSwitch.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("the delete drops the pairing claim on the device's request to come back", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId, jar } = await enrol(app, venue, mode);
    const revoked = await send(app, "POST", `/management-api/devices/${deviceId}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(revoked.status).toBe(204);

    const hold = mode.open();
    const knock = await send(app, "POST", "/api/device/join", {
      cookie: jar,
      body: { name: "Barra" },
    });
    expect(knock.status).toBe(200);
    expect(((await knock.json()) as { joinId: string }).joinId).toBe(deviceId);
    mode.claim(deviceId, {
      holdId: hold.holdId,
      sessionKey: hashSessionToken(venue.managerCookie.split("=")[1]!),
      personName: "Manager",
    });
    expect(mode.claimOf(deviceId)).toBeDefined();

    const res = await send(app, "DELETE", devicePath(deviceId), { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    expect(mode.claimOf(deviceId)).toBeUndefined();
  });
});
