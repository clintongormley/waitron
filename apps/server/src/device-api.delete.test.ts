/** The device delete routes, end to end over `app.request`. */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, devices, joinRequests, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  hashSecret,
  hashSessionToken,
  loginWithPin,
  persons,
  sessions,
} from "@waitron/identity";
import { payments } from "@waitron/payments";
import type { DeleteImpact } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { parkOrder } from "./working-order.js";
import { mountDeviceApi } from "./device-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  acceptDeviceJoinRequest,
  createJoinRequest,
  listPendingJoinRequests,
  provenDisabledDevice,
} from "./join-requests.js";
import { mountJoinApi } from "./join-api.js";
import { parseDeviceCookie } from "./device-session.js";
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

function mountApp(
  cfg: TillConfig,
  pairingMode: PairingMode = createPairingMode(),
  opts: { devMode?: boolean; now?: () => Date } = {},
): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.db, cfg, secureCookies: false, pairingMode, ...opts }, noopLog);
  mountJoinApi(
    app,
    { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
    noopLog,
  );
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

/** The cookie's value, as the knock route parses it. */
const cookieValue = (jar: string) => jar.slice(jar.indexOf("=") + 1);

async function deviceCount(): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(sql`select count(*) as n from devices`);
  return rows[0]!.n;
}

async function deleteThroughRoute(app: Hono, venue: Venue, deviceId: string): Promise<void> {
  const res = await send(app, "DELETE", devicePath(deviceId), { cookie: venue.managerCookie });
  expect(res.status).toBe(200);
}

/** The row a delete leaves: kept, disabled, stamped and with no token. */
async function expectStillDeleted(deviceId: string, tokenHash = ""): Promise<void> {
  const row = await deviceRow(deviceId);
  expect(row.deletedAt).not.toBeNull();
  expect(row.active).toBe(false);
  expect(row.tokenHash).toBe(tokenHash);
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

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

describe("a deleted device", () => {
  it("the device list leaves out a deleted device and still lists a disabled one", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const gone = await enrol(app, venue, mode, "Barra");
    const disabled = await enrol(app, venue, mode, "Terraza");
    await enrol(app, venue, mode, "Cocina");
    await deleteThroughRoute(app, venue, gone.deviceId);
    const revoked = await send(app, "POST", `${devicePath(disabled.deviceId)}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(revoked.status).toBe(204);

    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const listed = (await res.json()) as { id: string; active: boolean }[];

    const undeleted = await suite.db
      .select({ id: devices.id })
      .from(devices)
      .where(isNull(devices.deletedAt));
    expect(listed.map((row) => row.id).sort()).toEqual(undeleted.map((row) => row.id).sort());
    expect(listed.map((row) => row.id)).not.toContain(gone.deviceId);
    expect(listed.find((row) => row.id === disabled.deviceId)).toMatchObject({ active: false });
  });

  it("a deleted device answers 404 device.not_found to Disable, Edit, the delete-impact read and Delete, and nothing is written", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId } = await enrol(app, venue, mode, "Barra");
    const control = await enrol(app, venue, mode, "Terraza");
    await deleteThroughRoute(app, venue, deviceId);

    const editBody = async (id: string, name: string) => ({
      name,
      profileId: (await deviceRow(id)).deviceProfileId,
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
    });
    // The same shape of body edits a live device, so a refusal below is the deleted row's, not the
    // body's.
    const live = await send(app, "PATCH", devicePath(control.deviceId), {
      cookie: venue.managerCookie,
      body: await editBody(control.deviceId, "Terraza 2"),
    });
    expect(live.status).toBe(204);

    const body = await editBody(deviceId, "Barra 2");
    const state = await snapshot();
    for (const [method, path, sent] of [
      ["POST", `${devicePath(deviceId)}/revoke`, undefined],
      ["PATCH", devicePath(deviceId), body],
      ["GET", impactPath(deviceId), undefined],
      ["DELETE", devicePath(deviceId), undefined],
    ] as const) {
      const res = await send(app, method, path, { cookie: venue.managerCookie, body: sent });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
      expect(await res.json()).toMatchObject({
        error: { code: "device.not_found", params: { deviceId } },
      });
    }
    expect(await snapshot()).toEqual(state);
  });

  it("a deleted device's browser knocking again is a new request under a new id, and accepting it makes a second device", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId, jar } = await enrol(app, venue, mode, "Barra");
    await deleteThroughRoute(app, venue, deviceId);

    const hold = mode.open();
    const knock = await send(app, "POST", "/api/device/join", {
      cookie: jar,
      body: { name: "Barra" },
    });
    expect(knock.status).toBe(200);
    const { joinId } = (await knock.json()) as { joinId: string };
    expect(joinId).not.toBe(deviceId);

    const pending = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.managerCookie,
    });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual([
      expect.objectContaining({ id: joinId, returning: null }),
    ]);

    const profileId = await seedProfile();
    await withTransaction(suite.db, (tx) =>
      acceptDeviceJoinRequest(tx, venue.cfg, joinId, { label: "Barra", profileId }),
    );
    mode.release(hold.holdId);
    expect(await deviceCount()).toBe(2);
    expect((await deviceRow(joinId)).active).toBe(true);
    await expectStillDeleted(deviceId);
  });

  it("in dev mode, a deleted device's browser knocking again is enrolled at once as a new device", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg, createPairingMode(), { devMode: true });
    const first = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    expect(first.status).toBe(200);
    const { joinId: oldId } = (await first.json()) as { joinId: string };
    await deleteThroughRoute(app, venue, oldId);

    const again = await send(app, "POST", "/api/device/join", {
      body: { name: "Dev till" },
      cookie: deviceCookieFrom(first),
    });
    expect(again.status).toBe(200);
    const { joinId } = (await again.json()) as { joinId: string };
    expect(joinId).not.toBe(oldId);
    const me = await send(app, "GET", "/api/device/me", { cookie: deviceCookieFrom(again) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ deviceId: joinId, name: "Dev till" });
    expect(await deviceCount()).toBe(2);
    await expectStillDeleted(oldId);
  });

  it("a knock proved before the delete and written after it answers device.join_stale and leaves the deleted row as it was", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId, jar } = await enrol(app, venue, mode, "Barra");
    const revoked = await send(app, "POST", `${devicePath(deviceId)}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(revoked.status).toBe(204);
    const proof = await provenDisabledDevice(suite.db, parseDeviceCookie(cookieValue(jar)));
    expect(proof).not.toBeNull();

    await deleteThroughRoute(app, venue, deviceId);
    const before = await deviceRow(deviceId);
    const code = await codeOf(() =>
      withTransaction(suite.db, (tx) =>
        createJoinRequest(tx, venue.cfg, { kind: "device", label: "Barra", returning: proof }),
      ),
    );

    expect(code).toBe("device.join_stale");
    expect(await deviceRow(deviceId)).toEqual(before);
    await expectStillDeleted(deviceId);
    expect(await suite.db.select().from(joinRequests)).toEqual([]);
  });

  it("a pending request whose id names a deleted device is refused join_request.not_found on accept (backstop: the request row written straight into the database)", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId } = await enrol(app, venue, mode, "Barra");
    await deleteThroughRoute(app, venue, deviceId);
    await suite.db.insert(joinRequests).values({
      id: deviceId,
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
      kind: "device",
      label: "Barra",
      tokenHash: hashSecret("a token"),
      verificationNumber: "41",
      decoyNumbers: ["42", "43"],
    });
    const devicesBefore = await suite.db.select().from(devices);
    const profileId = await seedProfile();

    const code = await codeOf(() =>
      withTransaction(suite.db, (tx) =>
        acceptDeviceJoinRequest(tx, venue.cfg, deviceId, { label: "Barra", profileId }),
      ),
    );

    expect(code).toBe("join_request.not_found");
    expect(await suite.db.select().from(devices)).toEqual(devicesBefore);
    await expectStillDeleted(deviceId);
    // The refusal rolled the consuming delete back, so the request stays until it lapses.
    expect((await suite.db.select().from(joinRequests)).map((row) => row.id)).toEqual([deviceId]);
  });

  it("a new device is accepted under a deleted device's name at the same location", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId } = await enrol(app, venue, mode, "Barra");
    await deleteThroughRoute(app, venue, deviceId);

    const { holdId } = mode.open();
    const knock = await send(app, "POST", "/api/device/join", { body: { name: "Nueva" } });
    expect(knock.status).toBe(200);
    const { joinId, verificationNumber } = (await knock.json()) as {
      joinId: string;
      verificationNumber: string;
    };
    const [ask] = await withTransaction(suite.db, (tx) =>
      listPendingJoinRequests(tx, venue.cfg, "device"),
    );
    const checked = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/check`,
      {
        cookie: venue.managerCookie,
        body: { choice: verificationNumber, holdId, createdAt: ask!.createdAt },
      },
    );
    expect(checked.status).toBe(204);
    const profileId = await seedProfile();
    const accepted = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/accept`,
      { cookie: venue.managerCookie, body: { name: "Barra", profileId } },
    );
    expect(accepted.status).toBe(200);

    const named = await suite.db
      .select({ id: devices.id, locationId: devices.locationId })
      .from(devices)
      .where(eq(devices.label, "Barra"));
    expect(named.map((row) => row.id).sort()).toEqual([deviceId, joinId].sort());
    expect(new Set(named.map((row) => row.locationId))).toEqual(new Set([venue.cfg.locationId]));
    await expectStillDeleted(deviceId);
  });

  it("a battery report checked before the delete and written after it leaves the deleted row as it was (backstop: the deleted state written from the route's clock)", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    let deleteOnRead: string | null = null;
    const app = mountApp(venue.cfg, mode, {
      now: () => {
        const at = new Date();
        if (deleteOnRead !== null) {
          // The route reads its clock after `requireDevice` and before its transaction.
          suite.db.run(
            sql`update devices set active = 0, deleted_at = ${at.toISOString()}, token_hash = '' where id = ${deleteOnRead}`,
          );
        }
        return at;
      },
    });
    const { deviceId, jar } = await enrol(app, venue, mode, "Barra");
    deleteOnRead = deviceId;

    const res = await send(app, "PUT", "/api/device/battery", {
      cookie: jar,
      body: { level: 50, charging: false },
    });

    expect(res.status).toBe(204);
    const row = await deviceRow(deviceId);
    expect(row.deletedAt).not.toBeNull();
    expect({
      level: row.batteryLevel,
      charging: row.batteryCharging,
      reportedAt: row.batteryReportedAt,
    }).toEqual({ level: null, charging: null, reportedAt: null });
  });

  it("backstop: with a real token hash on the deleted row, its browser's knock still makes a new device", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const { deviceId, jar } = await enrol(app, venue, mode, "Barra");
    await deleteThroughRoute(app, venue, deviceId);
    const realHash = hashSecret(parseDeviceCookie(cookieValue(jar))!.token);
    await suite.db.update(devices).set({ tokenHash: realHash }).where(eq(devices.id, deviceId));

    const hold = mode.open();
    const knock = await send(app, "POST", "/api/device/join", {
      cookie: jar,
      body: { name: "Barra" },
    });
    mode.release(hold.holdId);

    expect(knock.status).toBe(200);
    expect(((await knock.json()) as { joinId: string }).joinId).not.toBe(deviceId);
    await expectStillDeleted(deviceId, realHash);
  });
});
