/**
 * The assembled device join-and-accept flow, with `device-api` and `join-api` mounted on one app
 * sharing ONE `PairingMode` holder, as `boot.ts` wires them: the window one surface opens is the
 * window the other honours.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  joinRequests,
  printers,
  withTransaction,
} from "@waitron/db";
import {
  hashPin,
  hashSessionToken,
  loginWithPin,
  persons,
  sessions,
  startManagementSession,
} from "@waitron/identity";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { cardReaders, deviceCardReaders } from "@waitron/payments";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mountDeviceApi } from "./device-api.js";
import { mountJoinApi } from "./join-api.js";
import { mountManagementApi } from "./management-api.js";
import { mountTillApi } from "./till-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";

/** Hooks a case sets to land a race at a fixed point; each is a no-op unless a case sets it. */
const between = vi.hoisted(() => ({
  /** After an ask has proved a disabled device, before its transaction opens: where a race with
   * another ask, or with Pair, lands. */
  proofAndTransaction: async (): Promise<void> => {},
  /** After the till sign-in checks its PIN, before the transaction that opens the session: where a
   * Disable or a profile move that overtakes a sign-in lands. */
  pinCheckAndSignIn: async (): Promise<void> => {},
}));
vi.mock("./join-requests.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./join-requests.js")>();
  return {
    ...real,
    provenDisabledDevice: async (...args: Parameters<typeof real.provenDisabledDevice>) => {
      const proof = await real.provenDisabledDevice(...args);
      await between.proofAndTransaction();
      return proof;
    },
  };
});
vi.mock("@waitron/identity", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...real,
    checkPin: async (...args: Parameters<typeof real.checkPin>) => {
      const checked = await real.checkPin(...args);
      await between.pinCheckAndSignIn();
      return checked;
    },
  };
});
afterEach(() => {
  between.proofAndTransaction = async () => {};
  between.pinCheckAndSignIn = async () => {};
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

/** `devMode` is left unset, so the real admin-approval flow runs rather than the dev auto-accept. */
function mountBoth(cfg: TillConfig, pairingMode: PairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.db, cfg, secureCookies: false, pairingMode }, noopLog);
  mountJoinApi(
    app,
    { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

/** Through the REAL management route, not `pairingMode.open()`. Returns the hold's id. */
async function openWindow(app: Hono, venue: Venue): Promise<string> {
  const res = await send(app, "POST", "/management-api/pairing-mode/holds", {
    cookie: venue.managerCookie,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { holdId: string }).holdId;
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

/** The ask the dashboard is showing under `id`, named as its actions name it: the createdAt the
 *  pending list gives it. */
async function shownAsk(app: Hono, venue: Venue, id: string): Promise<string> {
  const res = await send(app, "GET", "/management-api/join-requests?kind=device", {
    cookie: venue.managerCookie,
  });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { id: string; createdAt: string }[];
  return rows.find((row) => row.id === id)!.createdAt;
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
    const holdId = await openWindow(app, venue);

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
      {
        id: joinId,
        kind: "device",
        label: "Bar till",
        createdAt: expect.any(String),
        pairingBy: null,
        returning: null,
      },
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

    // 5. The admin matches the device's number, then approves it under a name (join-api routes).
    const checkRes = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/check`,
      {
        cookie: venue.managerCookie,
        body: { choice: verificationNumber, holdId, createdAt: await shownAsk(app, venue, joinId) },
      },
    );
    expect(checkRes.status).toBe(204);
    const acceptRes = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/accept`,
      { cookie: venue.managerCookie, body: { name: "Bar till", profileId } },
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

    // 7. And it is a working device cookie.
    const meRes = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toMatchObject({
      deviceId: joinId,
      formFactor: "till",
      name: "Bar till",
      stationId: null,
    });
  });

  it("a wrong number denies, and the device is told to ask again", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);

    const { joinId, verificationNumber, jar } = await knock(app, "Bar till");
    // Any two-digit string other than the device's real number is wrong by construction.
    const wrong = verificationNumber === "00" ? "01" : "00";

    const checkRes = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joinId}/check`,
      {
        cookie: venue.managerCookie,
        body: { choice: wrong, holdId, createdAt: await shownAsk(app, venue, joinId) },
      },
    );
    expect(checkRes.status).toBe(400);
    expect((await errorOf(checkRes)).code).toBe("device.join_mismatch");

    // The wrong tap DENIED: the device's status turns not_approved rather than staying pending.
    const statusRes = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ status: "not_approved" });
    expect(await pendingCount()).toBe(0);

    const again = await knock(app, "Bar till, second try");
    expect(again.joinId).not.toBe(joinId);
    expect(await pendingCount()).toBe(1);
    const checkAgain = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${again.joinId}/check`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: again.verificationNumber,
          holdId,
          createdAt: await shownAsk(app, venue, again.joinId),
        },
      },
    );
    expect(checkAgain.status).toBe(204);
    const acceptAgain = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${again.joinId}/accept`,
      { cookie: venue.managerCookie, body: { name: "Bar till", profileId } },
    );
    expect(acceptAgain.status).toBe(200);
  });

  it("a knock with the window shut writes nothing and leaves the window shut", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);

    // The window is never opened.
    const before = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    });

    const knockRes = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(knockRes.status).toBe(403);
    expect((await errorOf(knockRes)).code).toBe("device.pairing_closed");
    expect(knockRes.headers.get("set-cookie")).toBeNull();
    expect(await pendingCount()).toBe(0);

    const after = await send(app, "GET", "/management-api/pairing-mode", {
      cookie: venue.managerCookie,
    });
    expect(await after.json()).toEqual({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    });
  });
});

describe("a claim whose hold lapsed is forgotten only once its request's deletion commits", () => {
  /** Claim a knocked device's request under hold A, then let A lapse while hold B keeps the window
   *  open. */
  async function lapsedClaim() {
    const venue = await setupVenue(suite.db);
    let offset = 0;
    const mode = createPairingMode({ now: () => Date.now() + offset });
    const app = mountBoth(venue.cfg, mode);
    const holdA = await openWindow(app, venue);
    const device = await knock(app, "Bar till");
    const checked = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${device.joinId}/check`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: device.verificationNumber,
          holdId: holdA,
          createdAt: await shownAsk(app, venue, device.joinId),
        },
      },
    );
    expect(checked.status).toBe(204);
    offset += 2 * 60_000;
    mode.open();
    offset += 90_000;
    expect(mode.orphanedClaims()).toEqual([device.joinId]);
    return { venue, mode, app, device };
  }

  it("a refused request rolls the discard back and keeps the claim for the next discard", async () => {
    const { venue, mode, app, device } = await lapsedClaim();
    const refused = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.staffCookie,
    });
    expect(refused.status).toBe(403);
    // The staff request's transaction rolled back, row and all, so the claim must still be there.
    expect(await pendingCount()).toBe(1);
    expect(mode.orphanedClaims()).toEqual([device.joinId]);

    const status = await send(app, "GET", "/api/device/join/status", { cookie: device.jar });
    expect(await status.json()).toEqual({ status: "not_approved" });
    expect(await pendingCount()).toBe(0);
    expect(mode.orphanedClaims()).toEqual([]);
  });

  it("the device's status read forgets the claim it discarded", async () => {
    const { mode, app, device } = await lapsedClaim();
    const status = await send(app, "GET", "/api/device/join/status", { cookie: device.jar });
    expect(await status.json()).toEqual({ status: "not_approved" });
    expect(mode.orphanedClaims()).toEqual([]);
  });

  it("another device's knock forgets the claim it discarded", async () => {
    const { mode, app, device } = await lapsedClaim();
    const other = await knock(app, "Barra 2");
    expect(other.joinId).not.toBe(device.joinId);
    expect(await pendingCount()).toBe(1);
    expect(mode.orphanedClaims()).toEqual([]);
  });
});

describe("a disabled device comes back as the same device", () => {
  async function knockWith(app: Hono, name: string, cookie?: string): Promise<Response> {
    return send(app, "POST", "/api/device/join", {
      body: { name },
      ...(cookie === undefined ? {} : { cookie }),
    });
  }

  /** Check the number, then accept: the Pair step of the Add a device dialog. */
  async function pair(
    app: Hono,
    venue: Venue,
    holdId: string,
    joined: { joinId: string; verificationNumber: string },
    body: { name: string; profileId: string; stationId?: string },
  ): Promise<Response> {
    const checked = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${joined.joinId}/check`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: joined.verificationNumber,
          holdId,
          createdAt: await shownAsk(app, venue, joined.joinId),
        },
      },
    );
    expect(checked.status).toBe(204);
    return send(app, "POST", `/management-api/device-join-requests/${joined.joinId}/accept`, {
      cookie: venue.managerCookie,
      body,
    });
  }

  async function addDevice(
    app: Hono,
    venue: Venue,
    holdId: string,
    name: string,
    profileId: string,
  ): Promise<{ deviceId: string; jar: string }> {
    const joined = await knock(app, name);
    const accepted = await pair(app, venue, holdId, joined, { name, profileId });
    expect(accepted.status).toBe(200);
    return { deviceId: joined.joinId, jar: joined.jar };
  }

  async function disable(app: Hono, venue: Venue, deviceId: string): Promise<void> {
    const res = await send(app, "POST", `/management-api/devices/${deviceId}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(204);
  }

  async function deviceRow(id: string) {
    const [row] = await suite.db.select().from(devices).where(eq(devices.id, id));
    return row!;
  }

  async function deviceCount(): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(sql`select count(*) as n from devices`);
    return rows[0]!.n;
  }

  async function listJoinRequests(app: Hono, venue: Venue): Promise<unknown[]> {
    const res = await send(app, "GET", "/management-api/join-requests?kind=device", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as unknown[];
  }

  async function joined(res: Response) {
    expect(res.status).toBe(200);
    const body = (await res.json()) as { joinId: string; verificationNumber: string };
    return { ...body, jar: deviceCookieFrom(res) };
  }

  /** A till added and then disabled through the real routes, with the window left open. */
  async function disabledTill() {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountBoth(venue.cfg, mode);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    await disable(app, venue, deviceId);
    return { venue, mode, app, profileId, holdId, deviceId, jar };
  }

  /** The device-profile routes, on an app of their own: they live in the management API. */
  function mountProfiles(venue: Venue): Hono {
    const app = new Hono();
    mountManagementApi(
      app,
      {
        db: suite.db,
        cfg: venue.cfg,
        secureCookies: false,
        rpId: "localhost",
        origin: "http://localhost",
        credentialKeyRing: TOTP_KEY_RING,
      },
      noopLog,
    );
    return app;
  }

  async function deleteProfile(venue: Venue, profileId: string): Promise<Response> {
    return send(mountProfiles(venue), "DELETE", `/management-api/device-profiles/${profileId}`, {
      cookie: venue.managerCookie,
    });
  }

  async function listedProfileIds(venue: Venue): Promise<string[]> {
    const res = await send(mountProfiles(venue), "GET", "/management-api/device-profiles", {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { deviceProfiles: { id: string }[] }).deviceProfiles.map(
      (profile) => profile.id,
    );
  }

  /** A staff member with PIN 4321, signed in on each device given: one session cookie per device. */
  async function signedInOn(deviceIds: string[]): Promise<string[]> {
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: `Camarera ${randomUUID()}`, pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    const cookies: string[] = [];
    for (const deviceId of deviceIds) {
      const session = await withTransaction(suite.db, (tx) =>
        loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }),
      );
      cookies.push(`waitron_till_session=${session.token}`);
    }
    return cookies;
  }

  /** Read straight from the table: the rows a cookie could still sign in with. */
  async function openSessionsOn(deviceId: string): Promise<number> {
    const rows = await suite.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.endedAt)));
    return rows.length;
  }

  async function sessionRead(app: Hono, cookie: string): Promise<Response> {
    return send(app, "PUT", "/api/device/printers", { cookie, body: {} });
  }

  /** {@link mountBoth} plus the till's routes, so a sign-in goes through `POST /api/session`. */
  function mountWithSignIn(venue: Venue): Hono {
    const app = mountBoth(venue.cfg);
    mountTillApi(
      app,
      {
        db: suite.db,
        // Neither is reached: signing in files nothing and reads no clock.
        backend: {} as FiscalBackend,
        clock: {} as TrustedClock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: "es-ES",
      },
      noopLog,
    );
    return app;
  }

  async function signIn(app: Hono, jar: string, personId: string): Promise<Response> {
    return send(app, "POST", "/api/session", { cookie: jar, body: { personId, pin: "4321" } });
  }

  /** Moves a device onto another profile, naming it Bar till and leaving every printer unset. */
  async function moveOnto(
    app: Hono,
    venue: Venue,
    deviceId: string,
    profileId: string,
    stationId: string | null,
  ): Promise<void> {
    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie: venue.managerCookie,
      body: {
        name: "Bar till",
        profileId,
        stationId,
        watcherId: null,
        receiptPrinterId: null,
        paymentSlipPrinterId: null,
        madeHereStationIds: [],
      },
    });
    expect(res.status).toBe(204);
  }

  it("knocks as itself, is listed as returning, and Pair enables the same row with its settings", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar: oldJar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    await suite.db
      .insert(deviceMadeHereStations)
      .values({ deviceId, stationId: venue.defaultStationId });
    const [reader] = await suite.db
      .insert(cardReaders)
      .values({ provider: "fake", providerRef: "reader-1", name: "Lector 1" })
      .returning({ id: cardReaders.id });
    await suite.db.insert(deviceCardReaders).values({ deviceId, readerId: reader!.id });
    // Read once while active, so the old token is in the verified-token memory when it is refused.
    expect((await send(app, "GET", "/api/device/me", { cookie: oldJar })).status).toBe(200);
    await disable(app, venue, deviceId);
    const before = await deviceCount();

    const back = await joined(await knockWith(app, "Tablet", oldJar));
    expect(back.joinId).toBe(deviceId);
    expect(back.jar).toMatch(new RegExp(`^waitron_device=${deviceId}\\.`));
    expect(back.jar).not.toBe(oldJar);
    expect(await listJoinRequests(app, venue)).toEqual([
      {
        id: deviceId,
        kind: "device",
        label: "Tablet",
        createdAt: expect.any(String),
        pairingBy: null,
        returning: {
          name: "Bar till",
          profileId,
          stationId: null,
          watcherId: null,
          profileRetired: false,
        },
      },
    ]);
    const pending = await send(app, "GET", "/api/device/join/status", { cookie: back.jar });
    expect(await pending.json()).toEqual({ status: "pending" });

    const accepted = await pair(app, venue, holdId, back, { name: "Bar till", profileId });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ deviceId, name: "Bar till", formFactor: "till" });
    expect(await deviceCount()).toBe(before);
    expect(await pendingCount()).toBe(0);
    expect((await deviceRow(deviceId)).active).toBe(true);
    expect(
      await suite.db
        .select({ stationId: deviceMadeHereStations.stationId })
        .from(deviceMadeHereStations)
        .where(eq(deviceMadeHereStations.deviceId, deviceId)),
    ).toEqual([{ stationId: venue.defaultStationId }]);
    expect(
      await suite.db
        .select({ readerId: deviceCardReaders.readerId })
        .from(deviceCardReaders)
        .where(eq(deviceCardReaders.deviceId, deviceId)),
    ).toEqual([{ readerId: reader!.id }]);

    const approved = await send(app, "GET", "/api/device/join/status", { cookie: back.jar });
    expect(await approved.json()).toEqual({ status: "approved" });
    // The old cookie first, while the verified-token memory still holds the old token.
    const old = await send(app, "GET", "/api/device/me", { cookie: oldJar });
    expect(old.status).toBe(401);
    const me = await send(app, "GET", "/api/device/me", { cookie: back.jar });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ deviceId, name: "Bar till" });
  });

  it("ends the shift sessions the device had open when it was disabled", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Camarera", pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    const session = await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }),
    );
    const sessionCookie = `waitron_till_session=${session.token}`;
    const live = await send(app, "PUT", "/api/device/printers", {
      cookie: sessionCookie,
      body: {},
    });
    expect(live.status).toBe(200);
    await disable(app, venue, deviceId);

    const back = await joined(await knockWith(app, "Bar till", jar));
    expect((await pair(app, venue, holdId, back, { name: "Bar till", profileId })).status).toBe(
      200,
    );

    const after = await send(app, "PUT", "/api/device/printers", {
      cookie: sessionCookie,
      body: {},
    });
    expect(after.status).toBe(401);
    expect((await errorOf(after)).code).toBe("session.required");
  });

  it("Disable ends every shift session open on the device at once, and no other device's", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const other = await addDevice(app, venue, holdId, "Terrace till", profileId);
    const [first, second, elsewhere] = await signedInOn([deviceId, deviceId, other.deviceId]);
    expect((await sessionRead(app, first!)).status).toBe(200);
    expect(await openSessionsOn(deviceId)).toBe(2);

    await disable(app, venue, deviceId);

    expect(await openSessionsOn(deviceId)).toBe(0);
    expect(await openSessionsOn(other.deviceId)).toBe(1);
    for (const cookie of [first!, second!]) {
      const refused = await sessionRead(app, cookie);
      expect(refused.status).toBe(401);
      // Signed out, not merely on a disabled device.
      expect((await errorOf(refused)).code).toBe("session.required");
    }
    expect((await sessionRead(app, elsewhere!)).status).toBe(200);

    const back = await joined(await knockWith(app, "Bar till", jar));
    expect((await pair(app, venue, holdId, back, { name: "Bar till", profileId })).status).toBe(
      200,
    );
    expect(await openSessionsOn(deviceId)).toBe(0);
    const afterEnable = await sessionRead(app, first!);
    expect(afterEnable.status).toBe(401);
    expect((await errorOf(afterEnable)).code).toBe("session.required");
  });

  it("Enable ends a session left open on a device turned off outside the Disable route", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const [cookie] = await signedInOn([deviceId]);
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    expect(await openSessionsOn(deviceId)).toBe(1);

    const back = await joined(await knockWith(app, "Bar till", jar));
    expect((await pair(app, venue, holdId, back, { name: "Bar till", profileId })).status).toBe(
      200,
    );
    expect(await openSessionsOn(deviceId)).toBe(0);
    const afterEnable = await sessionRead(app, cookie!);
    expect(afterEnable.status).toBe(401);
    expect((await errorOf(afterEnable)).code).toBe("session.required");
  });

  it("a sign-in that Disable overtook is refused, and opens no session", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountWithSignIn(venue);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Camarera", pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    between.pinCheckAndSignIn = async () => {
      between.pinCheckAndSignIn = async () => {};
      await disable(app, venue, deviceId);
    };

    const late = await signIn(app, jar, person!.id);
    expect(late.status).toBe(401);
    expect((await errorOf(late)).code).toBe("device.unauthorized");
    expect(late.headers.get("set-cookie")).toBeNull();
    expect(await openSessionsOn(deviceId)).toBe(0);
  });

  it("a sign-in that Disable and then Enable both overtook is refused, and opens no session", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountWithSignIn(venue);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Camarera", pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    let enabledJar = "";
    between.pinCheckAndSignIn = async () => {
      between.pinCheckAndSignIn = async () => {};
      await disable(app, venue, deviceId);
      const back = await joined(await knockWith(app, "Bar till", jar));
      expect((await pair(app, venue, holdId, back, { name: "Bar till", profileId })).status).toBe(
        200,
      );
      enabledJar = back.jar;
    };

    const late = await signIn(app, jar, person!.id);
    expect(enabledJar).not.toBe("");
    expect(late.status).toBe(401);
    expect((await errorOf(late)).code).toBe("device.unauthorized");
    expect(await openSessionsOn(deviceId)).toBe(0);

    const fresh = await signIn(app, enabledJar, person!.id);
    expect(fresh.status).toBe(200);
    expect(await openSessionsOn(deviceId)).toBe(1);
    expect((await sessionRead(app, deviceCookieFrom(fresh))).status).toBe(200);
  });

  it("a sign-in overtaken by a move onto a kitchen-screen profile is refused, and opens no session", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountWithSignIn(venue);
    const profileId = await seedProfile("till");
    const kitchenId = await seedProfile("kds");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Camarera", pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    between.pinCheckAndSignIn = async () => {
      between.pinCheckAndSignIn = async () => {};
      await moveOnto(app, venue, deviceId, kitchenId, venue.defaultStationId);
    };

    const late = await signIn(app, jar, person!.id);
    expect(late.status).toBe(403);
    expect(await errorOf(late)).toMatchObject({
      code: "device.forbidden_action",
      params: { action: "sign_in" },
    });
    expect(late.headers.get("set-cookie")).toBeNull();
    expect(await openSessionsOn(deviceId)).toBe(0);
  });

  it("a kitchen screen's sign-in is refused before its PIN is checked", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountWithSignIn(venue);
    const kitchenId = await seedProfile("kds");
    const holdId = await openWindow(app, venue);
    const joined = await knock(app, "Pass screen");
    const accepted = await pair(app, venue, holdId, joined, {
      name: "Pass screen",
      profileId: kitchenId,
      stationId: venue.defaultStationId,
    });
    expect(accepted.status).toBe(200);
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Camarera", pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    let pinChecked = false;
    between.pinCheckAndSignIn = async () => {
      pinChecked = true;
    };

    const refused = await signIn(app, joined.jar, person!.id);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toMatchObject({
      code: "device.forbidden_action",
      params: { action: "sign_in" },
    });
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(pinChecked).toBe(false);
    expect(await openSessionsOn(joined.joinId)).toBe(0);
  });

  it("a sign-in overtaken by a move onto another till profile still signs in", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountWithSignIn(venue);
    const profileId = await seedProfile("till");
    const otherTillId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Camarera", pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id });
    let moved = false;
    between.pinCheckAndSignIn = async () => {
      between.pinCheckAndSignIn = async () => {};
      await moveOnto(app, venue, deviceId, otherTillId, null);
      moved = true;
    };

    const signedIn = await signIn(app, jar, person!.id);
    expect(moved).toBe(true);
    expect(signedIn.status).toBe(200);
    expect(await openSessionsOn(deviceId)).toBe(1);
  });

  it("a browser with no device cookie still joins as a new device", async () => {
    const { venue, app, deviceId } = await disabledTill();
    const fresh = await joined(await knockWith(app, "Tablet"));
    expect(fresh.joinId).not.toBe(deviceId);
    expect(await listJoinRequests(app, venue)).toMatchObject([
      { id: fresh.joinId, returning: null },
    ]);
  });

  it("a cookie naming a disabled device with the wrong token joins as a new device", async () => {
    const { venue, app, deviceId } = await disabledTill();
    const stored = await deviceRow(deviceId);
    const forged = await joined(
      await knockWith(app, "Tablet", `waitron_device=${deviceId}.not-the-token`),
    );
    expect(forged.joinId).not.toBe(deviceId);
    expect(await listJoinRequests(app, venue)).toMatchObject([
      { id: forged.joinId, returning: null },
    ]);
    expect(await deviceRow(deviceId)).toEqual(stored);
  });

  it("a cookie naming an active device joins as a new device and leaves that device working", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", profileId);
    const stored = await deviceRow(deviceId);

    const other = await joined(await knockWith(app, "Tablet", jar));
    expect(other.joinId).not.toBe(deviceId);
    expect(await listJoinRequests(app, venue)).toMatchObject([
      { id: other.joinId, returning: null },
    ]);
    expect(await deviceRow(deviceId)).toEqual(stored);
    expect((await send(app, "GET", "/api/device/me", { cookie: jar })).status).toBe(200);
  });

  it("with no Add a device dialog open, a disabled device's knock is refused and changes nothing", async () => {
    const { venue, app, holdId, deviceId, jar } = await disabledTill();
    const released = await send(app, "DELETE", `/management-api/pairing-mode/holds/${holdId}`, {
      cookie: venue.managerCookie,
    });
    expect(released.status).toBe(204);
    const stored = await deviceRow(deviceId);

    const res = await knockWith(app, "Bar till", jar);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("device.pairing_closed");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await pendingCount()).toBe(0);
    expect(await deviceRow(deviceId)).toEqual(stored);
  });

  it("deny leaves the device disabled with its settings, and the same browser can knock as itself again", async () => {
    const { venue, app, profileId, deviceId, jar } = await disabledTill();
    const before = await deviceCount();
    const back = await joined(await knockWith(app, "Bar till", jar));
    const denied = await send(app, "POST", `/management-api/join-requests/${deviceId}/deny`, {
      cookie: venue.managerCookie,
      body: { createdAt: await shownAsk(app, venue, deviceId) },
    });
    expect(denied.status).toBe(204);

    expect(await deviceCount()).toBe(before);
    expect(await deviceRow(deviceId)).toMatchObject({
      active: false,
      label: "Bar till",
      deviceProfileId: profileId,
      stationId: null,
      watcherId: null,
    });
    const status = await send(app, "GET", "/api/device/join/status", { cookie: back.jar });
    expect(await status.json()).toEqual({ status: "not_approved" });
    expect((await send(app, "GET", "/api/device/me", { cookie: back.jar })).status).toBe(401);

    const again = await joined(await knockWith(app, "Bar till", back.jar));
    expect(again.joinId).toBe(deviceId);
  });

  it("a second knock replaces the device's pending request and forgets the number check made on it", async () => {
    const { venue, app, profileId, holdId, deviceId, jar } = await disabledTill();
    const first = await joined(await knockWith(app, "Bar till", jar));
    const checked = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${deviceId}/check`,
      {
        cookie: venue.managerCookie,
        body: {
          choice: first.verificationNumber,
          holdId,
          createdAt: await shownAsk(app, venue, deviceId),
        },
      },
    );
    expect(checked.status).toBe(204);

    const second = await joined(await knockWith(app, "Bar till", first.jar));
    expect(second.joinId).toBe(deviceId);
    expect(await pendingCount()).toBe(1);
    const unchecked = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${deviceId}/accept`,
      { cookie: venue.managerCookie, body: { name: "Bar till", profileId } },
    );
    expect(unchecked.status).toBe(409);
    expect((await errorOf(unchecked)).code).toBe("join_request.unclaimed");

    const stale = await send(app, "GET", "/api/device/join/status", { cookie: first.jar });
    expect(await stale.json()).toEqual({ status: "not_approved" });
    expect((await pair(app, venue, holdId, second, { name: "Bar till", profileId })).status).toBe(
      200,
    );
    expect((await send(app, "GET", "/api/device/me", { cookie: second.jar })).status).toBe(200);
  });

  describe("a dialog still showing the ask a second knock replaced", () => {
    /** The device knocks, the dashboard lists that ask, and the device knocks again before the
     *  dashboard hears of it. */
    async function replacedAsk() {
      const till = await disabledTill();
      const first = await joined(await knockWith(till.app, "Bar till", till.jar));
      const shown = await shownAsk(till.app, till.venue, till.deviceId);
      const second = await joined(await knockWith(till.app, "Bar till", first.jar));
      expect(second.joinId).toBe(till.deviceId);
      return { ...till, first, second, shown };
    }

    async function statusOf(app: Hono, jar: string) {
      return (await send(app, "GET", "/api/device/join/status", { cookie: jar })).json();
    }

    it("Cancel is answered as for a request already gone, and the new ask stays pending", async () => {
      const { venue, app, deviceId, second, shown } = await replacedAsk();
      expect(await statusOf(app, second.jar)).toEqual({ status: "pending" });

      const denied = await send(app, "POST", `/management-api/join-requests/${deviceId}/deny`, {
        cookie: venue.managerCookie,
        body: { createdAt: shown },
      });
      expect(denied.status).toBe(404);
      expect((await errorOf(denied)).code).toBe("join_request.not_found");
      expect(await statusOf(app, second.jar)).toEqual({ status: "pending" });
      expect(await pendingCount()).toBe(1);
    });

    it("a number check with a number other than the new ask's is refused, and deletes and claims nothing", async () => {
      const { venue, mode, app, holdId, deviceId, first, second, shown } = await replacedAsk();
      const other = first.verificationNumber === "00" ? "01" : "00";
      await suite.db
        .update(joinRequests)
        .set({ verificationNumber: other })
        .where(eq(joinRequests.id, deviceId));

      const checked = await send(
        app,
        "POST",
        `/management-api/device-join-requests/${deviceId}/check`,
        {
          cookie: venue.managerCookie,
          body: { choice: first.verificationNumber, holdId, createdAt: shown },
        },
      );
      expect(checked.status).toBe(404);
      expect((await errorOf(checked)).code).toBe("join_request.not_found");
      expect(await statusOf(app, second.jar)).toEqual({ status: "pending" });
      expect(mode.claimOf(deviceId)).toBeUndefined();
    });

    it("a number check with the same number as the new ask's is refused, so Pair cannot approve the new ask", async () => {
      const { venue, mode, app, profileId, holdId, deviceId, first, second, shown } =
        await replacedAsk();
      await suite.db
        .update(joinRequests)
        .set({ verificationNumber: first.verificationNumber })
        .where(eq(joinRequests.id, deviceId));

      const checked = await send(
        app,
        "POST",
        `/management-api/device-join-requests/${deviceId}/check`,
        {
          cookie: venue.managerCookie,
          body: { choice: first.verificationNumber, holdId, createdAt: shown },
        },
      );
      expect(checked.status).toBe(404);
      expect((await errorOf(checked)).code).toBe("join_request.not_found");
      expect(mode.claimOf(deviceId)).toBeUndefined();
      const accepted = await send(
        app,
        "POST",
        `/management-api/device-join-requests/${deviceId}/accept`,
        { cookie: venue.managerCookie, body: { name: "Bar till", profileId } },
      );
      expect(accepted.status).toBe(409);
      expect((await errorOf(accepted)).code).toBe("join_request.unclaimed");
      expect(await statusOf(app, second.jar)).toEqual({ status: "pending" });
      expect((await send(app, "GET", "/api/device/me", { cookie: second.jar })).status).toBe(401);
    });

    it("a number check is answered as for a request already gone even when another login has claimed the new ask", async () => {
      const { venue, mode, app, holdId, deviceId, second, shown } = await replacedAsk();
      const [mgr] = await suite.db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.displayName, "The Manager"));
      const session = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { personId: mgr!.id }),
      );
      const other = { ...venue, managerCookie: `${MANAGEMENT_COOKIE}=${session.token}` };
      const otherHold = await openWindow(app, other);
      const claimed = await send(
        app,
        "POST",
        `/management-api/device-join-requests/${deviceId}/check`,
        {
          cookie: other.managerCookie,
          body: {
            choice: second.verificationNumber,
            holdId: otherHold,
            createdAt: await shownAsk(app, other, deviceId),
          },
        },
      );
      expect(claimed.status).toBe(204);

      const checked = await send(
        app,
        "POST",
        `/management-api/device-join-requests/${deviceId}/check`,
        {
          cookie: venue.managerCookie,
          body: { choice: second.verificationNumber, holdId, createdAt: shown },
        },
      );
      expect(checked.status).toBe(404);
      expect((await errorOf(checked)).code).toBe("join_request.not_found");
      expect(mode.claimOf(deviceId)?.sessionKey).toBe(hashSessionToken(session.token));
      expect(await statusOf(app, second.jar)).toEqual({ status: "pending" });
    });

    it("a number check of a replaced ask with a hold that has lapsed is answered as a lapsed hold, and the new ask is kept", async () => {
      const { venue, mode, app, deviceId, second, shown } = await replacedAsk();
      const checked = await send(
        app,
        "POST",
        `/management-api/device-join-requests/${deviceId}/check`,
        {
          cookie: venue.managerCookie,
          body: { choice: second.verificationNumber, holdId: randomUUID(), createdAt: shown },
        },
      );
      expect(checked.status).toBe(409);
      expect((await errorOf(checked)).code).toBe("device.pairing_hold_lapsed");
      expect(mode.claimOf(deviceId)).toBeUndefined();
      expect(await statusOf(app, second.jar)).toEqual({ status: "pending" });
    });

    it("the new ask is listed under a createdAt after the replaced one's, even in the same millisecond", async () => {
      const { venue, app, deviceId, jar } = await disabledTill();
      // Frozen at the present, so the window the case opened is still open.
      const frozen = Date.now();
      vi.useFakeTimers({ toFake: ["Date"], now: frozen });
      try {
        const first = await joined(await knockWith(app, "Bar till", jar));
        const shown = await shownAsk(app, venue, deviceId);
        await joined(await knockWith(app, "Bar till", first.jar));
        expect(shown).toBe(new Date(frozen).toISOString());
        expect(await shownAsk(app, venue, deviceId)).toBe(new Date(frozen + 1).toISOString());
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("an ask whose proof another ask overtook is refused with no cookie, and the browser keeps the winner's", async () => {
    const { venue, app, deviceId, jar } = await disabledTill();
    let winner: Awaited<ReturnType<typeof joined>> | undefined;
    between.proofAndTransaction = async () => {
      between.proofAndTransaction = async () => {};
      winner = await joined(await knockWith(app, "Bar till", jar));
    };

    const overtaken = await knockWith(app, "Bar till", jar);
    expect(overtaken.status).toBe(409);
    expect((await errorOf(overtaken)).code).toBe("device.join_stale");
    expect(overtaken.headers.get("set-cookie")).toBeNull();
    expect(winner!.joinId).toBe(deviceId);
    expect(await pendingCount()).toBe(1);
    expect(await listJoinRequests(app, venue)).toMatchObject([{ id: deviceId, returning: {} }]);

    const again = await joined(await knockWith(app, "Bar till", winner!.jar));
    expect(again.joinId).toBe(deviceId);
  });

  it("an ask that Pair overtook is refused with no cookie, and the browser's cookie is the enabled device's", async () => {
    const { venue, app, profileId, holdId, deviceId, jar } = await disabledTill();
    const first = await joined(await knockWith(app, "Bar till", jar));
    between.proofAndTransaction = async () => {
      between.proofAndTransaction = async () => {};
      const accepted = await pair(app, venue, holdId, first, { name: "Bar till", profileId });
      expect(accepted.status).toBe(200);
    };

    const overtaken = await knockWith(app, "Bar till", first.jar);
    expect(overtaken.status).toBe(409);
    expect((await errorOf(overtaken)).code).toBe("device.join_stale");
    expect(overtaken.headers.get("set-cookie")).toBeNull();
    expect(await pendingCount()).toBe(0);
    const me = await send(app, "GET", "/api/device/me", { cookie: first.jar });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ deviceId });
  });

  it("a profile whose only device was disabled deletes, and leaves the profile list", async () => {
    const { venue, profileId, deviceId } = await disabledTill();
    expect(await listedProfileIds(venue)).toContain(profileId);

    const removed = await deleteProfile(venue, profileId);
    expect(removed.status).toBe(204);
    expect(await listedProfileIds(venue)).not.toContain(profileId);
    const got = await send(
      mountProfiles(venue),
      "GET",
      `/management-api/device-profiles/${profileId}`,
      {
        cookie: venue.managerCookie,
      },
    );
    expect(got.status).toBe(404);
    expect((await errorOf(got)).code).toBe("device_profile.not_found");
    expect(await deviceRow(deviceId)).toMatchObject({ active: false, deviceProfileId: profileId });
  });

  it("a profile an active device holds is still refused 409 device_profile.in_use", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const profileId = await seedProfile("till");
    const holdId = await openWindow(app, venue);
    await addDevice(app, venue, holdId, "Bar till", profileId);

    const refused = await deleteProfile(venue, profileId);
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("device_profile.in_use");
    expect(await listedProfileIds(venue)).toContain(profileId);
  });

  it("a returning device whose profile was deleted is refused that profile, and the request survives", async () => {
    const { venue, app, profileId, holdId, deviceId, jar } = await disabledTill();
    expect((await deleteProfile(venue, profileId)).status).toBe(204);
    const back = await joined(await knockWith(app, "Bar till", jar));
    expect(back.joinId).toBe(deviceId);

    const refused = await pair(app, venue, holdId, back, { name: "Bar till", profileId });
    expect(refused.status).toBe(404);
    expect((await errorOf(refused)).code).toBe("device_profile.not_found");
    expect(await pendingCount()).toBe(1);
    expect(await deviceRow(deviceId)).toMatchObject({ active: false, deviceProfileId: profileId });

    const live = await seedProfile("till");
    const retried = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${deviceId}/accept`,
      { cookie: venue.managerCookie, body: { name: "Bar till", profileId: live } },
    );
    expect(retried.status).toBe(200);
    expect(await deviceRow(deviceId)).toMatchObject({ active: true, deviceProfileId: live });
  });

  it("lists a returning device whose profile was deleted as on a retired profile", async () => {
    const { venue, app, profileId, deviceId, jar } = await disabledTill();
    expect((await deleteProfile(venue, profileId)).status).toBe(204);
    await joined(await knockWith(app, "Bar till", jar));

    expect(await listJoinRequests(app, venue)).toMatchObject([
      { id: deviceId, returning: { profileId, profileRetired: true } },
    ]);
  });

  it("a returning device whose profile was deleted is enabled on a live profile, with that profile's first usable printers", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountBoth(venue.cfg);
    const [oldPrinter, newPrinter] = await suite.db
      .insert(printers)
      .values([
        {
          locationId: venue.cfg.locationId,
          name: "Old",
          transport: "network_tcp",
          host: "10.0.0.1",
        },
        {
          locationId: venue.cfg.locationId,
          name: "New",
          transport: "network_tcp",
          host: "10.0.0.2",
        },
      ])
      .returning({ id: printers.id });
    const oldProfile = await seedProfile("till");
    const newProfile = await seedProfile("till");
    await suite.db.insert(deviceProfilePrinters).values([
      { deviceProfileId: oldProfile, printerId: oldPrinter!.id, role: "receipt", position: 0 },
      { deviceProfileId: newProfile, printerId: newPrinter!.id, role: "receipt", position: 0 },
    ]);
    const holdId = await openWindow(app, venue);
    const { deviceId, jar } = await addDevice(app, venue, holdId, "Bar till", oldProfile);
    expect((await deviceRow(deviceId)).receiptPrinterId).toBe(oldPrinter!.id);
    await disable(app, venue, deviceId);
    expect((await deleteProfile(venue, oldProfile)).status).toBe(204);

    const back = await joined(await knockWith(app, "Bar till", jar));
    const accepted = await pair(app, venue, holdId, back, {
      name: "Bar till",
      profileId: newProfile,
    });
    expect(accepted.status).toBe(200);
    expect(await deviceRow(deviceId)).toMatchObject({
      id: deviceId,
      active: true,
      deviceProfileId: newProfile,
      receiptPrinterId: newPrinter!.id,
      paymentSlipPrinterId: null,
    });
    expect(await pendingCount()).toBe(0);
  });

  it("enabling under a name an active device has taken since is refused, and the request survives", async () => {
    const { venue, app, profileId, holdId, deviceId, jar } = await disabledTill();
    await addDevice(app, venue, holdId, "Bar till", profileId);
    const back = await joined(await knockWith(app, "Bar till", jar));

    const taken = await pair(app, venue, holdId, back, { name: "Bar till", profileId });
    expect(taken.status).toBe(409);
    expect((await errorOf(taken)).code).toBe("device.name_taken");
    expect(await pendingCount()).toBe(1);
    expect((await deviceRow(deviceId)).active).toBe(false);

    const renamed = await send(
      app,
      "POST",
      `/management-api/device-join-requests/${deviceId}/accept`,
      { cookie: venue.managerCookie, body: { name: "Bar till 2", profileId } },
    );
    expect(renamed.status).toBe(200);
    expect(await deviceRow(deviceId)).toMatchObject({ active: true, label: "Bar till 2" });
  });
});
