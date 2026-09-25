/**
 * The assembled device join-and-accept flow, with `device-api` and `join-api` mounted on one app
 * sharing ONE `PairingMode` holder, as `boot.ts` wires them: the window one surface opens is the
 * window the other honours.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mountDeviceApi } from "./device-api.js";
import { mountJoinApi } from "./join-api.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

/** `devMode` is left unset, so the real admin-approval flow runs rather than the dev auto-accept. */
function mountBoth(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.db, cfg, secureCookies: false, pairingMode }, noopLog);
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

function deviceCookieFrom(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

/** Through the REAL management route, not `pairingMode.open()`. */
async function openWindow(app: Hono, venue: Venue): Promise<void> {
  const res = await send(app, "POST", "/management-api/pairing-mode", {
    cookie: venue.managerCookie,
  });
  expect(res.status).toBe(200);
}

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

describe("device join and accept, end to end (both surfaces, one window)", () => {
  it("open the window, knock, match the number, and the device is in", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");

    // 1. The admin opens the venue's pairing window (join-api route).
    await openWindow(app, venue);

    // 2. The device knocks with only a name (device-api route); the token rides only the cookie.
    const { joinId, verificationNumber, jar } = await knock(app, "Bar till");
    expect(verificationNumber).toMatch(/^\d{2}$/);
    expect(jar).toContain(`${joinId}.`);

    // 3. The pending queue lists the ask WITHOUT the number: the admin must get it from the device.
    const listRes = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.managerCookie,
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as unknown[];
    // `toEqual`, so the EXACT key set proves no number field rides beside the ask (a substring scan
    // for a two-digit number would collide with the id and the timestamp).
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
    expect(await pendingCount()).toBe(0);

    // 6. The device polls status on its ORIGINAL cookie and is approved; the cookie is never re-issued.
    const statusRes = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ status: "approved" });
    expect(statusRes.headers.get("set-cookie")).toBeNull();

    // 7. And it is a working device cookie, carrying the register the accept created.
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
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
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

    // The wrong tap DENIED: the device's status turns not_approved rather than staying pending.
    const statusRes = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ status: "not_approved" });
    expect(await pendingCount()).toBe(0);

    const again = await knock(app, "Bar till, second try");
    expect(again.joinId).not.toBe(joinId);
    expect(await pendingCount()).toBe(1);
    const acceptAgain = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${again.joinId}/accept`,
      { cookie: venue.managerCookie, body: { choice: again.verificationNumber, profileId } },
    );
    expect(acceptAgain.status).toBe(200);
  });

  it("a knock with the window shut writes nothing and is counted, not recorded", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);

    // The window is never opened.
    const before = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ open: false, refusedRecently: 0 });

    const knockRes = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(knockRes.status).toBe(403);
    expect((await errorOf(knockRes)).code).toBe("device.pairing_closed");
    expect(knockRes.headers.get("set-cookie")).toBeNull();
    expect(await pendingCount()).toBe(0);

    // COUNTED, not RECORDED: the refused tally went up while the pending table stayed empty.
    const after = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(await after.json()).toMatchObject({ open: false, refusedRecently: 1 });
  });
});
