/**
 * The management-side join routes — the pairing window, the queue, the challenge, deny, accept and
 * self-enrol — on the engine the box now runs.
 *
 * ## What this file does not check
 *
 * SQLite has no roles and no grants: one process opens one file. Nothing here or elsewhere checks
 * that these routes reach only what the deployment role is allowed to reach.
 *
 * What every case below still proves is the ROUTE: its permission gate, its refusal codes, the
 * shape of what it returns, and what it leaves in the tables — none of which the database enforced.
 *
 * ## Which of the two `join-api` suites this is
 *
 * This file is `join-api.db.test.ts`, the `.db` naming the difference a reader can check in the two
 * import lists: this one opens a database — `useVenueDb`, and `mountJoinApi` driven over HTTP —
 * while `join-api.test.ts` imports only `vitest` and `@waitron/identity` and opens none. That
 * sibling is one case over the role map, asserting `device.manage` and `printer.manage` are held by
 * exactly the same roles; its own header sets out why that has to be asserted on the map rather
 * than through a route.
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
import { createPairingMode, PAIRING_WINDOW_MS, type PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";

// Each test provisions its OWN venue, and `useVenueDb` empties the data tables between tests, so
// the rows each case reads back are its own.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

function mountApp(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountJoinApi(app, { db: suite.db, cfg, pairingMode }, noopLog);
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

/** Mint a pending request straight through the verb — the knock ROUTE is `device-api.ts`'s, and
 *  every route under test here acts on a request that already exists. `numbers` pins the REAL number
 *  so the accept tests can name a wrong one deterministically (the decoys stay truly random, so a
 *  test never asserts on them by value). */
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
  // Through the table definition, as `apps/server/src/testing/fiscal-fixtures.ts` is:
  // `device_profiles.id`, `created_at` and `updated_at` are `$defaultFn` generators a raw insert
  // never reaches, and it is also what encodes `capabilities` — the `::jsonb` cast is a syntax
  // error to this parser (`unrecognized token: ":"`).
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${profileCounter}`, formFactor, capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** How many pending requests this venue holds — read straight from the table, so the assertion is
 *  about what is stored and not about what a route chose to show. */
async function pendingCount(): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    // No `::int` here or in the two sibling counts below: `count(*)` already comes back as a
    // JavaScript number, and the cast operator is a syntax error to this parser.
    sql`select count(*) as n from join_requests `,
  );
  return rows[0]!.n;
}

describe("the pairing-mode control", () => {
  it("GET reports a shut window, with the refused count", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    mode.noteRefused();
    mode.noteRefused();
    const app = mountApp(venue.cfg, mode);
    const res = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ open: false, openUntil: null, refusedRecently: 2 });
  });

  it("POST opens the window and returns openUntil; a second POST extends rather than stacking", async () => {
    const venue = await setupVenue(suite.db);
    let clock = Date.parse("2026-09-08T10:00:00.000Z");
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);

    const first = await send(app, "POST", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      openUntil: new Date(clock + PAIRING_WINDOW_MS).toISOString(),
    });
    expect(mode.isOpen()).toBe(true);

    // A minute later, re-opening moves the lapse to ONE window from now — not to two windows from
    // the first open, which is what stacking would give.
    clock += 60_000;
    const second = await send(app, "POST", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(await second.json()).toEqual({
      openUntil: new Date(clock + PAIRING_WINDOW_MS).toISOString(),
    });
  });

  it("GET reports the open window's lapse instant", async () => {
    const venue = await setupVenue(suite.db);
    const clock = Date.parse("2026-09-08T10:00:00.000Z");
    const mode = createPairingMode({ now: () => clock });
    const app = mountApp(venue.cfg, mode);
    await send(app, "POST", "/management-api/pairing-mode", { cookie: venue.managerCookie });
    const res = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(await res.json()).toEqual({
      open: true,
      openUntil: new Date(clock + PAIRING_WINDOW_MS).toISOString(),
      refusedRecently: 0,
    });
  });

  it("DELETE closes it", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, mode);
    const res = await send(app, "DELETE", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(204);
    expect(mode.isOpen()).toBe(false);
  });

  it.each([false, true])(
    "renews the window without extending the session (initially open: %s), while a manual open extends it",
    async (initiallyOpen) => {
      const venue = await setupVenue(suite.db);
      const token = venue.managerCookie.split("=")[1]!;
      let clock = Date.now();
      const mode = createPairingMode({ now: () => clock });
      const app = mountApp(venue.cfg, mode);
      if (initiallyOpen) mode.open();
      clock += 60_000;
      // The clock is read in JavaScript and the instant bound: this engine has neither `now()` nor
      // an interval type. One statement, so no transaction-start reading has to be shared. `clock`
      // above is the PAIRING mode's injected clock and is deliberately not this value: what is
      // being aged here is the management session's own `last_seen_at`.
      const sessionSeenAt = new Date(Date.now() - 10 * 60_000).toISOString();
      await suite.db.execute(sql`
      update management_sessions set last_seen_at = ${sessionSeenAt}
      where token_hash = ${hashSessionToken(token)}`);
      const session = () =>
        withTransaction(suite.db, (tx) => resolveManagementSession(tx, token, { touch: false }));
      const before = await session();
      const renewed = await send(app, "POST", "/management-api/pairing-mode/renew", {
        cookie: venue.managerCookie,
      });
      expect(renewed.status).toBe(200);
      expect(await renewed.json()).toEqual({
        openUntil: new Date(clock + PAIRING_WINDOW_MS).toISOString(),
      });
      expect((await session()).expiresAt).toBe(before.expiresAt);

      const manual = await send(app, "POST", "/management-api/pairing-mode", {
        cookie: venue.managerCookie,
      });
      expect(manual.status).toBe(200);
      expect(Date.parse((await session()).expiresAt)).toBeGreaterThan(Date.parse(before.expiresAt));
    },
  );

  it("refuses renewal after the management session expires without opening the window", async () => {
    const venue = await setupVenue(suite.db);
    const token = venue.managerCookie.split("=")[1]!;
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    const sessionSeenAt = new Date(Date.now() - 60 * 60_000).toISOString();
    await suite.db.execute(sql`
      update management_sessions set last_seen_at = ${sessionSeenAt}
      where token_hash = ${hashSessionToken(token)}`);
    const response = await send(app, "POST", "/management-api/pairing-mode/renew", {
      cookie: venue.managerCookie,
    });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("management_session.expired");
    expect(mode.isOpen()).toBe(false);
  });

  it("all window routes need device.manage — a staff session is 403 and the window is untouched", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    for (const [method, path] of [
      ["GET", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode/renew"],
      ["DELETE", "/management-api/pairing-mode"],
    ] as const) {
      const res = await send(app, method, path, { cookie: venue.staffCookie });
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toEqual({
        code: "authorization.not_permitted",
        params: { permission: "device.manage" },
      });
    }
    expect(mode.isOpen()).toBe(false);
  });

  it("all window routes need a management session at all", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    for (const [method, path] of [
      ["GET", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode/renew"],
      ["DELETE", "/management-api/pairing-mode"],
    ] as const) {
      const res = await send(app, method, path);
      expect(res.status).toBe(401);
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
    // Through the table definition, not raw SQL: a raw read skips drizzle's decoding and hands a
    // boolean column back as SQLite's 0/1, which `active: true` could never match.
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

    // A SEPARATE request, so the deny is read back across the transaction boundary the route committed
    // at. Throwing the mismatch from inside `withTransaction` would roll the consuming delete back and turn
    // a wrong tap into an unlimited retry — the 400 alone cannot tell the two shapes apart.
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

  it("a till profile auto-creates its register", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile("till");
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
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ formFactor: "till" });
    const { rows } = await suite.db.execute<{ name: string }>(sql`
      select t.name from tills t
      join devices d on d.till_id = t.id
      where d.id = ${made.joinId}`);
    expect(rows[0]!.name).toBe("Caja nueva");
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

    const badRegister = await send(app, "POST", path, {
      cookie,
      body: { choice: made.verificationNumber, profileId: randomUUID(), registerId: 7 },
    });
    expect((await errorOf(badRegister)).params).toEqual({ field: "registerId" });

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
    // Live id, unknown id, malformed id and a malformed BODY all answer 403 to a staff session. The
    // deny route's sibling test pins the same property for the shared paths; pinning it here too is
    // what keeps the file's two by-id orderings from drifting apart.
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
    // The real row carries the request's own id (so the agent's Bearer keeps working) and its label.
    // Through the table definition, for the reason the devices read-back above states.
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

    // The consuming delete stuck (the mismatch is thrown AFTER the transaction commits) — a FRESH
    // request, even with the RIGHT number, finds nothing. Rolling the delete back would turn a wrong
    // tap into an unlimited retry.
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
