import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { mountJoinApi } from "./join-api.js";
import { createJoinRequest, type JoinRequestKind, PENDING_CAP } from "./join-requests.js";
import { createPairingMode, PAIRING_WINDOW_MS, type PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";

// Real Postgres, not PGlite (CLAUDE.md §4): every route here runs as `app_user` under `withTenant`,
// so the join_requests / devices / tills grants are enforced. PGlite connects as a superuser holding
// every privilege, where a missing GRANT passes and fails only in production. Each test provisions
// its OWN tenant, so its rows are that test's alone and order-independent across the shared clone.
const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};

function mountApp(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountJoinApi(app, { db: suite.admin, cfg, pairingMode }, noopLog);
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
  return withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const made = await createJoinRequest(tx, venue.cfg, input);
    return { joinId: made.joinId, verificationNumber: made.verificationNumber };
  });
}

let profileCounter = 0;
async function seedProfile(
  cfg: TillConfig,
  formFactor: "till" | "kds" | "phone-portrait",
): Promise<string> {
  profileCounter += 1;
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor, capabilities)
    values (${cfg.tenantId}, ${`Profile ${profileCounter}`}, ${formFactor}, '[]'::jsonb)
    returning id`);
  return rows[0]!.id;
}

/** How many pending requests this tenant holds — read as the superuser, so the assertion is about the
 *  table and not about what a route chose to show. */
async function pendingCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from join_requests where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

describe("the pairing-mode control", () => {
  it("GET reports a shut window, with the refused count", async () => {
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, mode);
    const res = await send(app, "DELETE", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(204);
    expect(mode.isOpen()).toBe(false);
  });

  it("all three need device.manage — a staff session is 403 and the window is untouched", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, mode);
    for (const [method, path] of [
      ["GET", "/management-api/pairing-mode"],
      ["POST", "/management-api/pairing-mode"],
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

  it("all three need a management session at all", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/management-api/pairing-mode");
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("management_session.required");
  });
});

describe("GET /management-api/join-requests", () => {
  it("lists only the asked-for kind, and never the number", async () => {
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
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

  it("shows this tenant's requests only", async () => {
    const mine = await setupVenue(suite.admin);
    const theirs = await setupVenue(suite.admin);
    await knock(theirs, { kind: "device", label: "Their till" });
    const app = mountApp(mine.cfg);
    const res = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: mine.managerCookie,
    });
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /management-api/join-requests/:id/challenge", () => {
  it("returns three numbers, one of them the request's", async () => {
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
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

  it("is 404 for another tenant's request, which survives", async () => {
    const mine = await setupVenue(suite.admin);
    const theirs = await setupVenue(suite.admin);
    const made = await knock(theirs, { kind: "device", label: "Their till" });
    const app = mountApp(mine.cfg);
    const res = await send(app, "GET", `/management-api/join-requests/${made.joinId}/challenge`, {
      cookie: mine.managerCookie,
    });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("join_request.not_found");
    expect(await pendingCount(theirs.cfg)).toBe(1);
  });

  it("is 404 for an unknown or malformed id", async () => {
    const venue = await setupVenue(suite.admin);
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
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "device", label: "Bar till" });
    const first = await send(app, "POST", `/management-api/join-requests/${made.joinId}/deny`, {
      cookie: venue.managerCookie,
    });
    expect(first.status).toBe(204);
    expect(await pendingCount(venue.cfg)).toBe(0);
    const second = await send(app, "POST", `/management-api/join-requests/${made.joinId}/deny`, {
      cookie: venue.managerCookie,
    });
    expect(second.status).toBe(404);
    expect((await errorOf(second)).code).toBe("join_request.not_found");
  });

  it("denies a print_agent request under printer.manage", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const agent = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const refused = await send(app, "POST", `/management-api/join-requests/${agent.joinId}/deny`, {
      cookie: venue.staffCookie,
    });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).params).toEqual({ permission: "printer.manage" });
    expect(await pendingCount(venue.cfg)).toBe(1);
    const ok = await send(app, "POST", `/management-api/join-requests/${agent.joinId}/deny`, {
      cookie: venue.managerCookie,
    });
    expect(ok.status).toBe(204);
    expect(await pendingCount(venue.cfg)).toBe(0);
  });

  it("cannot reach another tenant's request", async () => {
    const mine = await setupVenue(suite.admin);
    const theirs = await setupVenue(suite.admin);
    const made = await knock(theirs, { kind: "device", label: "Their till" });
    const app = mountApp(mine.cfg);
    const res = await send(app, "POST", `/management-api/join-requests/${made.joinId}/deny`, {
      cookie: mine.managerCookie,
    });
    expect(res.status).toBe(404);
    expect(await pendingCount(theirs.cfg)).toBe(1);
  });

  it("answers 403 to a caller holding NEITHER permission, for a live id AND an unknown one", async () => {
    const venue = await setupVenue(suite.admin);
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
    expect(await pendingCount(venue.cfg)).toBe(1);
  });
});

describe("POST /management-api/device-join-requests/:id/accept", () => {
  it("enrols the device when the number matches, and the request is consumed", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "kds");
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
    expect(await pendingCount(venue.cfg)).toBe(0);
    const { rows } = await suite.admin.execute<{
      label: string;
      station_id: string;
      active: boolean;
    }>(sql`select label, station_id, active from devices where id = ${made.joinId}`);
    expect(rows[0]).toMatchObject({
      label: "Pantalla Cocina",
      station_id: venue.defaultStationId,
      active: true,
    });
  });

  it("a wrong number is 400 device.join_mismatch AND the request is gone on a FRESH request", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "kds");
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
    // at. Throwing the mismatch from inside `withTenant` would roll the consuming delete back and turn
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
    expect(await pendingCount(venue.cfg)).toBe(0);
  });

  it("refuses a print_agent request with 404, which survives", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "kds");
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
    expect(await pendingCount(venue.cfg)).toBe(1);
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from devices where id = ${agent.joinId}`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("needs device.manage", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "kds");
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
    expect(await pendingCount(venue.cfg)).toBe(1);
  });

  it("a till profile auto-creates its register", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "till");
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
    const { rows } = await suite.admin.execute<{ name: string }>(sql`
      select t.name from tills t
      join devices d on d.till_id = t.id and d.tenant_id = t.tenant_id
      where d.id = ${made.joinId}`);
    expect(rows[0]!.name).toBe("Caja nueva");
  });

  it("a kds profile with no station is 400, and the request survives for a genuine retry", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "kds");
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
    expect(await pendingCount(venue.cfg)).toBe(1);
  });

  it("screens the body, and refuses the request before any of it is acted on", async () => {
    const venue = await setupVenue(suite.admin);
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

    expect(await pendingCount(venue.cfg)).toBe(1);
  });

  it("an unknown profile is 404 and the request survives", async () => {
    const venue = await setupVenue(suite.admin);
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
    expect(await pendingCount(venue.cfg)).toBe(1);
  });

  it("cannot accept another tenant's request", async () => {
    const mine = await setupVenue(suite.admin);
    const theirs = await setupVenue(suite.admin);
    const profileId = await seedProfile(mine.cfg, "till");
    const made = await knock(theirs, { kind: "device", label: "Their till" });
    const app = mountApp(mine.cfg);
    const res = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${made.joinId}/accept`,
      {
        cookie: mine.managerCookie,
        body: { choice: made.verificationNumber, profileId },
      },
    );
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("join_request.not_found");
    expect(await pendingCount(theirs.cfg)).toBe(1);
  });

  it("is 404 for a malformed id", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const res = await send(app, "POST", "/management-api/device-join-requests/nope/accept", {
      cookie: venue.managerCookie,
      body: { choice: "42", profileId: randomUUID() },
    });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("join_request.not_found");
  });

  it("gates BEFORE it screens — an unauthorised caller learns nothing about its own input", async () => {
    const venue = await setupVenue(suite.admin);
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
    expect(await pendingCount(venue.cfg)).toBe(1);
  });
});

describe("POST /management-api/print-agent-join-requests/:id/accept", () => {
  async function agentCount(cfg: TillConfig): Promise<number> {
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from print_agents where tenant_id = ${cfg.tenantId}`,
    );
    return rows[0]!.n;
  }

  it("enrols the agent when the number matches, and the request is consumed", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const made = await knock(venue, { kind: "print_agent", label: "Cocina agent" });
    const res = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${made.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: made.verificationNumber } },
    );
    expect(res.status).toBe(204);
    expect(await pendingCount(venue.cfg)).toBe(0);
    // The real row carries the request's own id (so the agent's Bearer keeps working) and its label.
    const { rows } = await suite.admin.execute<{ name: string; active: boolean }>(
      sql`select name, active from print_agents where id = ${made.joinId}`,
    );
    expect(rows[0]).toMatchObject({ name: "Cocina agent", active: true });
  });

  it("a wrong number is 400 device.join_mismatch, no print_agents row, and the request is gone on a FRESH retry", async () => {
    const venue = await setupVenue(suite.admin);
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
    expect(await agentCount(venue.cfg)).toBe(0);

    // The consuming delete stuck (the mismatch is thrown AFTER the transaction commits) — a FRESH
    // request, even with the RIGHT number, finds nothing. Rolling the delete back would turn a wrong
    // tap into an unlimited retry.
    const retry = await send(app, "POST", path, {
      cookie: venue.managerCookie,
      body: { choice: made.verificationNumber },
    });
    expect(retry.status).toBe(404);
    expect((await errorOf(retry)).code).toBe("join_request.not_found");
    expect(await pendingCount(venue.cfg)).toBe(0);
  });

  it("this route 404s a DEVICE request, and the device accept route 404s a print_agent request (kind filtering)", async () => {
    const venue = await setupVenue(suite.admin);
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
    const profileId = await seedProfile(venue.cfg, "till");
    const asDevice = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${agent.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: agent.verificationNumber, profileId } },
    );
    expect(asDevice.status).toBe(404);
    expect((await errorOf(asDevice)).code).toBe("join_request.not_found");

    // Both asks survive, untouched.
    expect(await pendingCount(venue.cfg)).toBe(2);
    expect(await agentCount(venue.cfg)).toBe(0);
  });

  it("needs printer.manage — a staff session is 403 and the request survives", async () => {
    const venue = await setupVenue(suite.admin);
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
    expect(await pendingCount(venue.cfg)).toBe(1);
    expect(await agentCount(venue.cfg)).toBe(0);
  });

  it("is 404 for an unknown or malformed id, and screens a missing choice", async () => {
    const venue = await setupVenue(suite.admin);
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

  it("cannot accept another tenant's request (real app_user, two tenants)", async () => {
    const mine = await setupVenue(suite.admin);
    const theirs = await setupVenue(suite.admin);
    const made = await knock(theirs, { kind: "print_agent", label: "Their agent" });
    // My printer.manage session, scoped to MY tenant, cannot reach their request — the accept's own
    // tenant predicate rides its consuming delete, so a globally-unique join id is not the boundary.
    const app = mountApp(mine.cfg);
    const res = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${made.joinId}/accept`,
      { cookie: mine.managerCookie, body: { choice: made.verificationNumber } },
    );
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("join_request.not_found");
    // Their ask survives; no agent row appears in either tenant.
    expect(await pendingCount(theirs.cfg)).toBe(1);
    expect(await agentCount(mine.cfg)).toBe(0);
    expect(await agentCount(theirs.cfg)).toBe(0);
  });
});

describe("the pending cap is the list's bound", () => {
  it("lists at most the cap, because the knock verb refuses past it", async () => {
    const venue = await setupVenue(suite.admin);
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
