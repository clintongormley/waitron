import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { mountDeviceApi } from "./device-api.js";
import { mountJoinApi } from "./join-api.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";

// Real Postgres, not PGlite (CLAUDE.md §4): every route here runs as `app_user` under `withTenant`, so
// the join_requests / devices / device_profiles grants are enforced and — since RLS was dropped (#255)
// — the two-tenant test genuinely exercises each route's own `eq(table.tenantId, cfg.tenantId)`
// predicate. On PGlite every connection is a superuser holding every privilege AND the tenant predicate
// decides nothing, so the cross-tenant probe below would be a false pass. Each test provisions its OWN
// tenant(s), so its rows are that test's alone and order-independent across the shared clone.
//
// This is the ONLY file that mounts BOTH route modules on one app sharing ONE `PairingMode`, so it is
// the regression guard for the assembled device join-and-accept flow: the device knocks (device-api),
// an admin opens the window / reads the queue / challenges / accepts / denies (join-api), and the
// window one surface opens is the window the other honours because it is the same holder instance.
const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};

/** Mount the device surface AND the management join surface on ONE Hono app, sharing ONE `db` and ONE
 *  `PairingMode` — the wiring `boot.ts` builds for a venue. Sharing the holder is the whole point: a
 *  window opened through `POST /management-api/pairing-mode` (join-api) must admit a knock on
 *  `POST /api/device/join` (device-api). `devMode` is left FALSE, so the real admin-approval flow runs
 *  rather than the dev auto-accept. */
function mountBoth(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.admin, cfg, secureCookies: false, pairingMode }, noopLog);
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

/** The `<name>=<value>` cookie pair the knock response set — the jar the device carries thereafter. */
function deviceCookieFrom(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

/** Open the venue's pairing window through the REAL management route (not `pairingMode.open()`), as the
 *  manager — so the e2e exercises the admin act that admits a knock, on the SAME holder the device mount
 *  reads. */
async function openWindow(app: Hono, venue: Venue): Promise<void> {
  const res = await send(app, "POST", "/management-api/pairing-mode", {
    cookie: venue.managerCookie,
  });
  expect(res.status).toBe(200);
}

/** Knock as a device on the REAL route, returning the join id, the number the device was shown, and the
 *  cookie jar the route set. The window must already be open. */
async function knock(
  app: Hono,
  name: string,
): Promise<{ joinId: string; verificationNumber: string; jar: string }> {
  const res = await send(app, "POST", "/api/device/join", { body: { name } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { joinId: string; verificationNumber: string };
  return {
    joinId: body.joinId,
    verificationNumber: body.verificationNumber,
    jar: deviceCookieFrom(res),
  };
}

let profileCounter = 0;
/** Seed a `device_profiles` row of the given form factor, read back its id (superuser SQL, fixture
 *  setup). A per-suite counter keeps the tenant-unique name from colliding across the shared clone. */
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

describe("device join and accept, end to end (both surfaces, one window)", () => {
  it("open the window, knock, match the number, and the device is in", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "till");

    // 1. The admin opens the venue's pairing window (join-api route).
    await openWindow(app, venue);

    // 2. The device knocks with only a name (device-api route) — the shared window admits it because the
    //    admin's open() above landed on the SAME holder. It is shown its number; the token rides only the
    //    cookie.
    const { joinId, verificationNumber, jar } = await knock(app, "Bar till");
    expect(verificationNumber).toMatch(/^\d{2}$/);
    expect(jar).toContain(`${joinId}.`);

    // 3. The pending queue lists the ask WITHOUT the number beside it — the admin must match a number they
    //    can only get from the device, never from their own screen (design §1.2 rule 1).
    const listRes = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.managerCookie,
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as unknown[];
    // `toEqual`, not `toMatchObject`: a key never listed is a key never checked, so pinning the EXACT key
    // set is what proves no number field rides beside the ask (a substring scan for the number itself is
    // no good — a two-digit value collides with the id and the timestamp).
    expect(list).toEqual([
      { id: joinId, kind: "device", label: "Bar till", createdAt: expect.any(String) },
    ]);

    // 4. The challenge gives the admin three numbers to pick from, one of them the device's real one.
    const challengeRes = await send(
      app,
      "GET",
      `/management-api/join-requests/${joinId}/challenge`,
      { cookie: venue.managerCookie },
    );
    expect(challengeRes.status).toBe(200);
    const { choices } = (await challengeRes.json()) as { choices: string[] };
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toContain(verificationNumber);
    for (const c of choices) expect(c).toMatch(/^\d{2}$/);

    // 5. The admin matches the device's number and accepts (join-api route). A till profile auto-creates
    //    the device's own register.
    const acceptRes = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: verificationNumber, profileId } },
    );
    expect(acceptRes.status).toBe(200);
    expect(await acceptRes.json()).toEqual({
      deviceId: joinId,
      name: "Bar till",
      formFactor: "till",
    });
    expect(await pendingCount(venue.cfg)).toBe(0);

    // 6. The device polls status on its ORIGINAL cookie and is now approved — the selector is the request
    //    id accept carried onto the devices row, so the cookie is set once at the knock and never
    //    re-issued: no Set-Cookie on the status response.
    const statusRes = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ status: "approved" });
    expect(statusRes.headers.get("set-cookie")).toBeNull();

    // 7. And it is a working device cookie: /me reports the device, carrying the register the accept
    //    created (a till device rings its own — `tillId` is set).
    const meRes = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toMatchObject({
      deviceId: joinId,
      formFactor: "till",
      name: "Bar till",
      stationId: null,
      tillId: expect.any(String),
    });
  });

  it("a wrong number denies, and the device is told to ask again", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "till");
    await openWindow(app, venue);

    const { joinId, verificationNumber, jar } = await knock(app, "Bar till");
    // Any two-digit string other than the device's real number is wrong by construction.
    const wrong = verificationNumber === "00" ? "01" : "00";

    const acceptRes = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: wrong, profileId } },
    );
    expect(acceptRes.status).toBe(400);
    expect((await errorOf(acceptRes)).code).toBe("device.join_mismatch");

    // The wrong tap DENIED: the request is consumed (committed after the transaction, not rolled back),
    // so the device's own status turns not_approved rather than staying pending for an unlimited retry.
    const statusRes = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ status: "not_approved" });
    expect(await pendingCount(venue.cfg)).toBe(0);

    // A follow-up knock starts afresh — the window is still open, and the new ask is a new pending row
    // the admin can now approve.
    const again = await knock(app, "Bar till, second try");
    expect(again.joinId).not.toBe(joinId);
    expect(await pendingCount(venue.cfg)).toBe(1);
    const acceptAgain = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${again.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: again.verificationNumber, profileId } },
    );
    expect(acceptAgain.status).toBe(200);
  });

  it("two tenants: A's manager can neither see, challenge, accept nor deny B's request", async () => {
    // The by-id isolation class the till-reroute S3 leak was paid for (CLAUDE.md §3), RUN as `app_user`
    // against real Postgres so the tenant predicate actually decides the answer. A holds its OWN rows as
    // positive controls, so every cross-tenant refusal below is shown to distinguish cross-tenant from
    // same-tenant: the same verb answers 200/204/present for A's own id and 404/absent for B's.
    const a = await setupVenue(suite.admin);
    const b = await setupVenue(suite.admin);
    const appA = mountBoth(a.cfg);
    const appB = mountBoth(b.cfg);
    const profileA = await seedProfile(a.cfg, "till");

    await openWindow(appB, b);
    const bReq = await knock(appB, "B bar till");

    await openWindow(appA, a);
    const aToDeny = await knock(appA, "A till to deny");
    const aToAccept = await knock(appA, "A till to accept");

    // (1) SEE — A's device queue lists A's OWN requests and never B's. Non-vacuous: the list is not merely
    //     empty, it contains A's two ids; it simply excludes B's.
    const listRes = await send(appA, "GET", "/management-api/join-requests?kind=device", {
      cookie: a.managerCookie,
    });
    expect(listRes.status).toBe(200);
    const ids = ((await listRes.json()) as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(aToDeny.joinId);
    expect(ids).toContain(aToAccept.joinId);
    expect(ids).not.toContain(bReq.joinId);

    // (2) CHALLENGE — B's id is 404 to A (join_request.not_found), while A's OWN id is 200. The 404 is the
    //     tenant predicate, not a dead route or a malformed id.
    const chalB = await send(
      appA,
      "GET",
      `/management-api/join-requests/${bReq.joinId}/challenge`,
      {
        cookie: a.managerCookie,
      },
    );
    expect(chalB.status).toBe(404);
    expect((await errorOf(chalB)).code).toBe("join_request.not_found");
    const chalA = await send(
      appA,
      "GET",
      `/management-api/join-requests/${aToDeny.joinId}/challenge`,
      { cookie: a.managerCookie },
    );
    expect(chalA.status).toBe(200);

    // (3) DENY — A cannot delete B's request (404), and B's request SURVIVES; A's own request denies (204).
    const denyB = await send(appA, "POST", `/management-api/join-requests/${bReq.joinId}/deny`, {
      cookie: a.managerCookie,
    });
    expect(denyB.status).toBe(404);
    expect(await pendingCount(b.cfg)).toBe(1);
    const denyA = await send(appA, "POST", `/management-api/join-requests/${aToDeny.joinId}/deny`, {
      cookie: a.managerCookie,
    });
    expect(denyA.status).toBe(204);

    // (4) ACCEPT — even with B's OWN correct number, A's tenant predicate makes the consuming delete match
    //     zero rows → 404, and B's request survives; A's own request accepts (200). Knowing the number is
    //     not enough: only the tenant that owns the row can approve it.
    const acceptB = await send(
      appA,
      "POST",
      `/management-api/device-join-requests/${bReq.joinId}/accept`,
      { cookie: a.managerCookie, body: { choice: bReq.verificationNumber, profileId: profileA } },
    );
    expect(acceptB.status).toBe(404);
    expect((await errorOf(acceptB)).code).toBe("join_request.not_found");
    expect(await pendingCount(b.cfg)).toBe(1);
    const acceptA = await send(
      appA,
      "POST",
      `/management-api/device-join-requests/${aToAccept.joinId}/accept`,
      {
        cookie: a.managerCookie,
        body: { choice: aToAccept.verificationNumber, profileId: profileA },
      },
    );
    expect(acceptA.status).toBe(200);
  });

  it("a knock with the window shut writes nothing and is counted, not recorded", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountBoth(venue.cfg);

    // The window is never opened. First read the refused counter through the management route.
    const before = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ open: false, refusedRecently: 0 });

    // The knock is refused before any DB work — nothing external may block a sale, so a flood on this
    // unauthenticated route draws no connection and creates no row (CLAUDE.md §5).
    const knockRes = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(knockRes.status).toBe(403);
    expect((await errorOf(knockRes)).code).toBe("device.pairing_closed");
    expect(knockRes.headers.get("set-cookie")).toBeNull();
    expect(await pendingCount(venue.cfg)).toBe(0);

    // The refusal was COUNTED, not RECORDED: the shut window's refused tally, which the dashboard renders
    // beside the toggle, went up by one, while the pending table stayed empty.
    const after = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(await after.json()).toMatchObject({ open: false, refusedRecently: 1 });
  });
});
