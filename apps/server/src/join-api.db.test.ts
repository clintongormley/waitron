/**
 * The management-side join routes — the window's holds, the queue, the challenge, deny and accept —
 * driven over HTTP. The role-map fact they rely on is pinned in `join-api.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, devices, printAgents, withTransaction } from "@waitron/db";
import { hashSessionToken, resolveManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mountJoinApi } from "./join-api.js";
import { createJoinRequest, type JoinRequestKind, PENDING_CAP } from "./join-requests.js";
import { createPairingMode, PAIRING_HOLD_MS, type PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";
import { createWatcher, removeWatcher } from "./watchers.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

function mountApp(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountJoinApi(
    app,
    { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

interface ErrorBody {
  error: { code: string; params: Record<string, unknown> };
}

async function errorOf(res: Response): Promise<ErrorBody["error"]> {
  return ((await res.json()) as ErrorBody).error;
}

/** Mint a pending request through the verb; the knock ROUTE is `device-api.ts`'s. `numbers` pins the
 *  REAL number so the accept tests can name a wrong one; the decoys stay random. */
async function knock(
  venue: Venue,
  input: { kind: JoinRequestKind; label: string; numbers?: () => number },
): Promise<{ joinId: string; verificationNumber: string }> {
  return withTransaction(suite.db, async (tx) => {
    const made = await createJoinRequest(tx, venue.cfg, input);
    return { joinId: made.joinId, verificationNumber: made.verificationNumber };
  });
}

let profileCounter = 0;
async function seedProfile(formFactor: "till" | "kds" | "phone-portrait"): Promise<string> {
  profileCounter += 1;
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${profileCounter}`, formFactor, capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** Read straight from the table: the assertion is about what is stored, not what a route shows. */
async function pendingCount(): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from join_requests `,
  );
  return rows[0]!.n;
}

describe("the join window's holds", () => {
  it("GET reports a shut window and the address devices use", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    });
  });

  it("taking a hold answers its id and lapse instant, and GET then reports the open window", async () => {
    const venue = await setupVenue(suite.db);
    const clock = Date.parse("2026-09-08T10:00:00.000Z");
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);
    const taken = await send(app, "POST", "/management-api/pairing-mode/holds", {
      cookie: venue.managerCookie,
    });
    expect(taken.status).toBe(200);
    const openUntil = new Date(clock + PAIRING_HOLD_MS).toISOString();
    const body = (await taken.json()) as { holdId: string; openUntil: string };
    expect(body).toEqual({ holdId: expect.any(String), openUntil });
    expect(mode.hasHold(body.holdId)).toBe(true);
    const res = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(await res.json()).toEqual({
      open: true,
      openUntil,
      deviceAddress: "https://waitron.local",
    });
  });

  it("taking a hold opens the window; releasing it shuts it", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const taken = await send(app, "POST", "/management-api/pairing-mode/holds", {
      cookie: venue.managerCookie,
    });
    expect(taken.status).toBe(200);
    const { holdId } = (await taken.json()) as { holdId: string; openUntil: string };
    expect(mode.isOpen()).toBe(true);
    const released = await send(app, "DELETE", `/management-api/pairing-mode/holds/${holdId}`, {
      cookie: venue.managerCookie,
    });
    expect(released.status).toBe(204);
    expect(mode.isOpen()).toBe(false);
  });

  it("releasing one hold leaves the window open", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const take = async () =>
      (
        (await (
          await send(app, "POST", "/management-api/pairing-mode/holds", {
            cookie: venue.managerCookie,
          })
        ).json()) as { holdId: string }
      ).holdId;
    const a = await take();
    const b = await take();
    await send(app, "DELETE", `/management-api/pairing-mode/holds/${a}`, {
      cookie: venue.managerCookie,
    });
    expect(mode.isOpen()).toBe(true);
    expect(mode.hasHold(a)).toBe(false);
    expect(mode.hasHold(b)).toBe(true);
  });

  it("releasing an unknown hold is not an error", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const { holdId } = mode.open();
    const app = mountApp(venue.cfg, mode);
    const res = await send(app, "DELETE", `/management-api/pairing-mode/holds/${randomUUID()}`, {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(204);
    expect(mode.hasHold(holdId)).toBe(true);
  });

  it("renews a live hold and refuses an unknown one with device.pairing_hold_lapsed", async () => {
    const venue = await setupVenue(suite.db);
    let clock = Date.parse("2026-09-08T10:00:00.000Z");
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);
    const { holdId } = mode.open();
    clock += 60_000;
    const ok = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, {
      cookie: venue.managerCookie,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      openUntil: new Date(clock + PAIRING_HOLD_MS).toISOString(),
    });
    const unknown = await send(
      app,
      "POST",
      `/management-api/pairing-mode/holds/${randomUUID()}/renew`,
      { cookie: venue.managerCookie },
    );
    expect(unknown.status).toBe(409);
    expect(await errorOf(unknown)).toEqual({ code: "device.pairing_hold_lapsed", params: {} });
  });

  it("refuses to renew a hold that has lapsed on the clock", async () => {
    const venue = await setupVenue(suite.db);
    let clock = Date.parse("2026-09-08T10:00:00.000Z");
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);
    const { holdId } = mode.open();
    clock += PAIRING_HOLD_MS;
    const res = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("device.pairing_hold_lapsed");
    expect(mode.isOpen()).toBe(false);
  });

  it("a fresh holder (a restart) refuses a hold taken before it", async () => {
    const venue = await setupVenue(suite.db);
    const before = createPairingMode();
    const { holdId } = before.open();
    const app = mountApp(venue.cfg, createPairingMode());
    const res = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("device.pairing_hold_lapsed");
  });

  it("renews a hold without extending the session, while taking a hold extends it", async () => {
    const venue = await setupVenue(suite.db);
    const token = venue.managerCookie.split("=")[1]!;
    let clock = Date.now();
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);
    const { holdId } = mode.open();
    clock += 60_000;
    // `clock` is the PAIRING mode's injected clock and deliberately not this value: what is being
    // aged here is the management session's own `last_seen_at`.
    const sessionSeenAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await suite.db.execute(sql`
      update management_sessions set last_seen_at = ${sessionSeenAt}
      where token_hash = ${hashSessionToken(token)}`);
    const session = () =>
      withTransaction(suite.db, (tx) => resolveManagementSession(tx, token, { touch: false }));
    const before = await session();
    const renewed = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, {
      cookie: venue.managerCookie,
    });
    expect(renewed.status).toBe(200);
    expect(await renewed.json()).toEqual({
      openUntil: new Date(clock + PAIRING_HOLD_MS).toISOString(),
    });
    expect((await session()).expiresAt).toBe(before.expiresAt);

    const taken = await send(app, "POST", "/management-api/pairing-mode/holds", {
      cookie: venue.managerCookie,
    });
    expect(taken.status).toBe(200);
    expect(Date.parse((await session()).expiresAt)).toBeGreaterThan(Date.parse(before.expiresAt));
  });

  it("refuses renewal after the management session expires, and the hold is not renewed", async () => {
    const venue = await setupVenue(suite.db);
    const token = venue.managerCookie.split("=")[1]!;
    let clock = Date.parse("2026-09-08T10:00:00.000Z");
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);
    const { holdId, openUntil } = mode.open();
    clock += 60_000;
    const sessionSeenAt = new Date(Date.now() - 60 * 60_000).toISOString();
    await suite.db.execute(sql`
      update management_sessions set last_seen_at = ${sessionSeenAt}
      where token_hash = ${hashSessionToken(token)}`);
    const response = await send(app, "POST", `/management-api/pairing-mode/holds/${holdId}/renew`, {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("management_session.expired");
    expect(mode.openUntil()).toBe(openUntil);
  });

  it("refuses staff on every hold route before saying anything else, and holds are untouched", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const { holdId, openUntil } = mode.open();
    const app = mountApp(venue.cfg, mode);
    for (const [method, path] of [
      ["GET", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode/holds"],
      ["POST", `/management-api/pairing-mode/holds/${randomUUID()}/renew`],
      ["POST", `/management-api/pairing-mode/holds/${holdId}/renew`],
      ["DELETE", `/management-api/pairing-mode/holds/${randomUUID()}`],
      ["DELETE", `/management-api/pairing-mode/holds/${holdId}`],
    ] as const) {
      const res = await send(app, method, path, { cookie: venue.staffCookie });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
      expect(await errorOf(res)).toEqual({
        code: "authorization.not_permitted",
        params: { permission: "device.manage" },
      });
    }
    expect(mode.hasHold(holdId)).toBe(true);
    expect(mode.openUntil()).toBe(openUntil);
  });

  it("every hold route needs a management session at all", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const [method, path] of [
      ["GET", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode/holds"],
      ["POST", `/management-api/pairing-mode/holds/${randomUUID()}/renew`],
      ["DELETE", `/management-api/pairing-mode/holds/${randomUUID()}`],
    ] as const) {
      const res = await send(app, method, path);
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
      expect((await errorOf(res)).code).toBe("management_session.required");
    }
  });
});

describe("GET /management-api/join-requests", () => {
  it("lists only the asked-for kind, and never the number", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const device = await knock(venue, { kind: "device", label: "Bar till" });
    await knock(venue, { kind: "print_agent", label: "Cocina agent" });

    const res = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(200);
    // `toEqual`, not `toMatchObject`: the list must never carry the answer beside the question, and a
    // key never listed is a key never checked.
    expect(await res.json()).toEqual([
      {
        id: device.joinId,
        kind: "device",
        label: "Bar till",
        createdAt: expect.any(String),
      },
    ]);
  });

  it("lists the print_agent kind under printer.manage, not device.manage", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const agent = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    await knock(venue, { kind: "device", label: "Bar till" });

    const res = await send(app, "GET", "/management-api/join-requests?kind=print_agent", {
      cookie: venue.managerCookie,
    });
    expect(await res.json()).toEqual([
      {
        id: agent.joinId,
        kind: "print_agent",
        label: "Cocina agent",
        createdAt: expect.any(String),
      },
    ]);

    // The permission named in the refusal is what proves the kind — not the role map, which grants
    // manager both. A staff session holds neither, so the code it is refused UNDER is the observable.
    const refused = await send(app, "GET", "/management-api/join-requests?kind=print_agent", {
      cookie: venue.staffCookie,
    });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "printer.manage" },
    });

    const refusedDevice = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.staffCookie,
    });
    expect((await errorOf(refusedDevice)).params).toEqual({ permission: "device.manage" });
  });

  it("refuses an absent or unknown kind", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const path of [
      "/management-api/join-requests",
      "/management-api/join-requests?kind=printer",
    ]) {
      const res = await send(app, "GET", path, { cookie: venue.managerCookie });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({
        code: "management.request_invalid",
        params: { field: "kind" },
      });
    }
  });
});

describe("GET /management-api/join-requests/:id/challenge", () => {
  it("returns three numbers, one of them the request's", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "device", label: "Bar till", numbers: () => 42 });
    const res = await send(app, "GET", `/management-api/join-requests/${made.joinId}/challenge`, {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(200);
    const { choices } = (await res.json()) as { choices: string[] };
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toContain("42");
    for (const choice of choices) expect(choice).toMatch(/^\d{2}$/);
  });

  it("takes its permission from the row's kind", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const agent = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const ok = await send(app, "GET", `/management-api/join-requests/${agent.joinId}/challenge`, {
      cookie: venue.managerCookie,
    });
    expect(ok.status).toBe(200);
    const refused = await send(
      app,
      "GET",
      `/management-api/join-requests/${agent.joinId}/challenge`,
      { cookie: venue.staffCookie },
    );
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).params).toEqual({ permission: "printer.manage" });
  });

  it("is 404 for an unknown or malformed id", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const res = await send(app, "GET", `/management-api/join-requests/${id}/challenge`, {
        cookie: venue.managerCookie,
      });
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("join_request.not_found");
    }
  });
});

describe("POST /management-api/join-requests/:id/deny", () => {
  it("deletes the request; a second deny is 404", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "device", label: "Bar till" });
    const first = await send(app, "POST", `/management-api/join-requests/${made.joinId}/deny`, {
      cookie: venue.managerCookie,
    });
    expect(first.status).toBe(204);
    expect(await pendingCount()).toBe(0);
    const second = await send(app, "POST", `/management-api/join-requests/${made.joinId}/deny`, {
      cookie: venue.managerCookie,
    });
    expect(second.status).toBe(404);
    expect((await errorOf(second)).code).toBe("join_request.not_found");
  });

  it("denies a print_agent request under printer.manage", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const agent = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const refused = await send(app, "POST", `/management-api/join-requests/${agent.joinId}/deny`, {
      cookie: venue.staffCookie,
    });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).params).toEqual({ permission: "printer.manage" });
    expect(await pendingCount()).toBe(1);
    const ok = await send(app, "POST", `/management-api/join-requests/${agent.joinId}/deny`, {
      cookie: venue.managerCookie,
    });
    expect(ok.status).toBe(204);
    expect(await pendingCount()).toBe(0);
  });

  it("answers 403 to a caller holding NEITHER permission, for a live id AND an unknown one", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const live = await knock(venue, { kind: "device", label: "Bar till" });
    // The status code must not be the oracle that tells an unauthorised caller which ids are live: a
    // 403-vs-404 split would enumerate the venue's pending requests one guess at a time.
    for (const id of [live.joinId, randomUUID()]) {
      const res = await send(app, "POST", `/management-api/join-requests/${id}/deny`, {
        cookie: venue.staffCookie,
      });
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("authorization.not_permitted");
    }
    expect(await pendingCount()).toBe(1);
  });
});

describe("POST /management-api/device-join-requests/:id/accept", () => {
  it("accepts a watcher-bound kitchen screen and validates its watcher field", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("kds");
    const { id: watcherId } = await withTransaction(suite.db, (tx) =>
      createWatcher(tx, venue.cfg, {
        name: "Pass",
        everyStation: true,
        stationIds: [],
        everyZone: true,
        zoneIds: [],
        runsPass: false,
      }),
    );
    const made = await knock(venue, { kind: "device", label: "Pass screen" });
    const path = `/management-api/device-join-requests/${made.joinId}/accept`;
    const body = { choice: made.verificationNumber, profileId, watcherId };
    const accepted = await send(app, "POST", path, { cookie: venue.managerCookie, body });
    expect(accepted.status).toBe(200);
    const [binding] = await suite.db
      .select({ stationId: devices.stationId, watcherId: devices.watcherId })
      .from(devices)
      .where(eq(devices.id, made.joinId));
    expect(binding).toEqual({ stationId: null, watcherId });
    const malformed = await knock(venue, { kind: "device", label: "Bad screen" });
    const invalid = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${malformed.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: { choice: malformed.verificationNumber, profileId, watcherId: "bad" },
      },
    );
    expect(invalid.status).toBe(400);
    expect(await errorOf(invalid)).toMatchObject({
      code: "management.request_invalid",
      params: { field: "watcherId" },
    });
    await withTransaction(suite.db, (tx) => removeWatcher(tx, venue.cfg, watcherId));
    const removed = await knock(venue, { kind: "device", label: "Removed screen" });
    const refused = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${removed.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: { choice: removed.verificationNumber, profileId, watcherId },
      },
    );
    expect(refused.status).toBe(404);
    expect(await errorOf(refused)).toMatchObject({ code: "watcher.not_found" });
  });
  it("enrols the device when the number matches, and the request is consumed", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("kds");
    const made = await knock(venue, { kind: "device", label: "Pantalla Cocina" });
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: made.verificationNumber,
          profileId,
          stationId: venue.defaultStationId,
        },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deviceId: made.joinId,
      name: "Pantalla Cocina",
      formFactor: "kds",
    });
    expect(await pendingCount()).toBe(0);
    // Through the table definition: a raw read hands the boolean column back as 0/1.
    const rows = await suite.db
      .select({ label: devices.label, stationId: devices.stationId, active: devices.active })
      .from(devices)
      .where(eq(devices.id, made.joinId));
    expect(rows[0]).toMatchObject({
      label: "Pantalla Cocina",
      stationId: venue.defaultStationId,
      active: true,
    });
  });

  it("a wrong number is 400 device.join_mismatch AND the request is gone on a FRESH request", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("kds");
    const made = await knock(venue, {
      kind: "device",
      label: "Pantalla Cocina",
      numbers: () => 42,
    });
    // `numbers: () => 42` pins the real number, so "07" is wrong by construction.
    const wrong = "07";
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: { choice: wrong, profileId, stationId: venue.defaultStationId },
      },
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("device.join_mismatch");

    // A SEPARATE request, so the deny is read back after the route's transaction committed: the 400
    // alone cannot tell a committed deny from a rolled-back one.
    const retry = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: made.verificationNumber,
          profileId,
          stationId: venue.defaultStationId,
        },
      },
    );
    expect(retry.status).toBe(404);
    expect((await errorOf(retry)).code).toBe("join_request.not_found");
    expect(await pendingCount()).toBe(0);
  });

  it("refuses a print_agent request with 404, which survives", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("kds");
    const agent = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${agent.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: agent.verificationNumber,
          profileId,
          stationId: venue.defaultStationId,
        },
      },
    );
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("join_request.not_found");
    // The agent's ask is untouched: a device.manage holder cannot turn it into a device.
    expect(await pendingCount()).toBe(1);
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from devices where id = ${agent.joinId}`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("needs device.manage", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("kds");
    const made = await knock(venue, { kind: "device", label: "Pantalla Cocina" });
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.staffCookie,
        body: {
          choice: made.verificationNumber,
          profileId,
          stationId: venue.defaultStationId,
        },
      },
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).params).toEqual({ permission: "device.manage" });
    expect(await pendingCount()).toBe(1);
  });

  it("a name an active device here already has is 409 device.name_taken, and the request survives", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("till");
    await enrolDeviceForTest(suite.db, venue.cfg, { name: "Caja nueva", profileId });
    const made = await knock(venue, { kind: "device", label: "Caja nueva" });
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: { choice: made.verificationNumber, profileId },
      },
    );
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("device.name_taken");
    expect(await pendingCount()).toBe(1);
  });

  it("a kds profile with no station is 400, and the request survives for a genuine retry", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("kds");
    const made = await knock(venue, { kind: "device", label: "Pantalla Cocina" });
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: { choice: made.verificationNumber, profileId },
      },
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("device.station_required");
    // The consuming delete rolled back with the throw: only a wrong number or a success sticks.
    expect(await pendingCount()).toBe(1);
  });

  it("screens the body, and refuses the request before any of it is acted on", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "device", label: "Bar till" });
    const path = `/management-api/device-join-requests/${made.joinId}/accept`;
    const cookie = venue.managerCookie;

    const noChoice = await send(app, "POST", path, {
      cookie,
      body: { profileId: randomUUID() },
    });
    expect(noChoice.status).toBe(400);
    expect(await errorOf(noChoice)).toEqual({
      code: "management.request_invalid",
      params: { field: "choice" },
    });

    const badProfile = await send(app, "POST", path, {
      cookie,
      body: { choice: made.verificationNumber, profileId: "not-a-uuid" },
    });
    expect((await errorOf(badProfile)).params).toEqual({ field: "profileId" });

    const badStation = await send(app, "POST", path, {
      cookie,
      body: { choice: made.verificationNumber, profileId: randomUUID(), stationId: "nope" },
    });
    expect((await errorOf(badStation)).params).toEqual({ field: "stationId" });

    expect(await pendingCount()).toBe(1);
  });

  it("an unknown profile is 404 and the request survives", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "device", label: "Bar till" });
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: venue.managerCookie,
        body: { choice: made.verificationNumber, profileId: randomUUID() },
      },
    );
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("device_profile.not_found");
    expect(await pendingCount()).toBe(1);
  });

  it("is 404 for a malformed id", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const res = await send(app, "POST", "/management-api/device-join-requests/nope/accept", {
      cookie: venue.managerCookie,
      body: { choice: "42", profileId: randomUUID() },
    });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("join_request.not_found");
  });

  it("gates BEFORE it screens — an unauthorised caller learns nothing about its own input", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const live = await knock(venue, { kind: "device", label: "Bar till" });
    // Live id, unknown id, malformed id and a malformed BODY all answer 403 to a staff session.
    const cases: { path: string; body: unknown }[] = [
      { path: live.joinId, body: { choice: live.verificationNumber, profileId: randomUUID() } },
      { path: randomUUID(), body: { choice: "42", profileId: randomUUID() } },
      { path: "nope", body: { choice: "42", profileId: randomUUID() } },
      { path: live.joinId, body: {} },
    ].map((c) => ({ path: `/management-api/device-join-requests/${c.path}/accept`, body: c.body }));
    for (const { path, body } of cases) {
      const res = await send(app, "POST", path, { cookie: venue.staffCookie, body });
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("authorization.not_permitted");
    }
    expect(await pendingCount()).toBe(1);
  });
});

describe("POST /management-api/print-agent-join-requests/:id/accept", () => {
  async function agentCount(): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from print_agents `,
    );
    return rows[0]!.n;
  }

  it("enrols the agent when the number matches, and the request is consumed", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const res = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${made.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: made.verificationNumber } },
    );
    expect(res.status).toBe(204);
    expect(await pendingCount()).toBe(0);
    // The request's own id, so the agent's Bearer keeps working. Through the table definition, for
    // the reason the devices read-back above states.
    const rows = await suite.db
      .select({ name: printAgents.name, active: printAgents.active })
      .from(printAgents)
      .where(eq(printAgents.id, made.joinId));
    expect(rows[0]).toMatchObject({ name: "Cocina agent", active: true });
  });

  it("a wrong number is 400 device.join_mismatch, no print_agents row, and the request is gone on a FRESH retry", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, {
      kind: "print_agent",
      label: "Cocina agent",
      numbers: () => 42,
    });
    const path = `/management-api/print-agent-join-requests/${made.joinId}/accept`;
    const wrong = await send(app, "POST", path, {
      cookie: venue.managerCookie,
      body: { choice: "07" }, // 42 is the real number, so 07 is wrong by construction
    });
    expect(wrong.status).toBe(400);
    expect((await errorOf(wrong)).code).toBe("device.join_mismatch");
    expect(await agentCount()).toBe(0);

    // The consuming delete stuck: a FRESH request, even with the RIGHT number, finds nothing.
    const retry = await send(app, "POST", path, {
      cookie: venue.managerCookie,
      body: { choice: made.verificationNumber },
    });
    expect(retry.status).toBe(404);
    expect((await errorOf(retry)).code).toBe("join_request.not_found");
    expect(await pendingCount()).toBe(0);
  });

  it("this route 404s a DEVICE request, and the device accept route 404s a print_agent request (kind filtering)", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const device = await knock(venue, { kind: "device", label: "Bar till" });
    // The print accept route cannot consume a device request.
    const asPrint = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${device.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: device.verificationNumber } },
    );
    expect(asPrint.status).toBe(404);
    expect((await errorOf(asPrint)).code).toBe("join_request.not_found");

    // The device accept route cannot consume a print_agent request (the mirror predicate).
    const agent = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const profileId = await seedProfile("till");
    const asDevice = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${agent.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: agent.verificationNumber, profileId } },
    );
    expect(asDevice.status).toBe(404);
    expect((await errorOf(asDevice)).code).toBe("join_request.not_found");

    // Both asks survive, untouched.
    expect(await pendingCount()).toBe(2);
    expect(await agentCount()).toBe(0);
  });

  it("needs printer.manage — a staff session is 403 and the request survives", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const res = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${made.joinId}/accept`,
      { cookie: venue.staffCookie, body: { choice: made.verificationNumber } },
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).params).toEqual({ permission: "printer.manage" });
    expect(await pendingCount()).toBe(1);
    expect(await agentCount()).toBe(0);
  });

  it("is 404 for an unknown or malformed id, and screens a missing choice", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const res = await send(
        app,
        "POST",
        `/management-api/print-agent-join-requests/${id}/accept`,
        {
          cookie: venue.managerCookie,
          body: { choice: "42" },
        },
      );
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("join_request.not_found");
    }
    const made = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const noChoice = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${made.joinId}/accept`,
      { cookie: venue.managerCookie, body: {} },
    );
    expect(noChoice.status).toBe(400);
    expect(await errorOf(noChoice)).toEqual({
      code: "management.request_invalid",
      params: { field: "choice" },
    });
  });
});

describe("the pending cap is the list's bound", () => {
  it("lists at most the cap, because the knock verb refuses past it", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (let i = 0; i < PENDING_CAP; i++) {
      await knock(venue, { kind: "device", label: `Till ${i}` });
    }
    const res = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.managerCookie,
    });
    expect(((await res.json()) as unknown[]).length).toBe(PENDING_CAP);
  });
});
