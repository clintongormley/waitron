import { testTradingAdmission } from "./testing/trading-admission.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceProfiles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashSessionToken, loginWithPin, persons, sessions } from "@waitron/identity";
import { PERSON_HEADER } from "@waitron/shared";
import { mountDeviceApi } from "./device-api.js";
import { mountTillApi } from "./till-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createStation } from "./kitchen.js";
import { inTx, setupPartyVenue } from "./testing/party-venue.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { BASIC_ACTIONS, revokedDeviceSessionCookie } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const log = () => {};

/** A venue with the till and device surfaces mounted, and Ana and Ben, each with a PIN. */
async function fixture() {
  const v = await setupPartyVenue(suite.db);
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "es-ES",
    },
    log,
  );
  mountDeviceApi(
    app,
    { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    log,
  );
  const person = async (name: string, pin: string) => {
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: name, pinHash: fixturePinHash(pin), role: "staff" })
      .returning({ id: persons.id });
    return row!.id;
  };
  const ana = await person("Ana", "4411");
  const ben = await person("Ben", "4422");
  const profile = async (formFactor: "kds" | "till") => {
    const [row] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: `${formFactor} ${randomUUID()}`,
        formFactor,
        capabilities: [...BASIC_ACTIONS, "run-the-pass"],
      })
      .returning({ id: deviceProfiles.id });
    return row!.id;
  };
  const grill = (await inTx(v, (tx) => createStation(tx, { name: "Grill" }))).id;
  /** A device with Ana signed in and then Ben, each session's cookie beside the device's. */
  const device = async (
    formFactor: "kds" | "till",
    screen: { stationId: string } | { kitchenScreen: { kind: "pass" } },
  ) => {
    const joined = await enrolDeviceForTest(suite.db, v.cfg, {
      name: `Device ${randomUUID()}`,
      profileId: await profile(formFactor),
      ...("stationId" in screen
        ? { stationId: screen.stationId }
        : { kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null } }),
    });
    const jar = `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}`;
    // Opened directly: a kitchen display has no sign-in, but its cookie can still carry a token.
    const sessionOf = async (personId: string) => {
      const token = randomUUID();
      await suite.db
        .insert(sessions)
        .values({ deviceId: joined.deviceId, personId, tokenHash: hashSessionToken(token) });
      return `${jar}; ${SESSION_COOKIE}=${token}`;
    };
    const anaCookie = await sessionOf(ana);
    const benCookie = await sessionOf(ben);
    return { id: joined.deviceId, jar, ana: anaCookie, ben: benCookie };
  };
  /** Ana's and Ben's sessions, in that order, on the venue's own till. */
  const login = async (personId: string, pin: string) => {
    const session = await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId: v.cfg.origin.deviceId, personId, pin }),
    );
    return `${SESSION_COOKIE}=${session.token}`;
  };
  const till = { ana: await login(ana, "4411"), ben: await login(ben, "4422") };
  return { v, app, ana, ben, grill, device, till };
}

async function call(
  app: Hono,
  path: string,
  cookie: string,
  person?: string,
  init: { method?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { cookie, "content-type": "application/json" };
  if (person !== undefined) headers[PERSON_HEADER] = person;
  const response = await app.request(path, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, json: (await response.json()) as unknown };
}

const refusal = (personId: string | null) => ({
  status: 409,
  json: { error: { code: "session.person_not_signed_in", params: { personId } } },
});

describe("a session route and the person header", () => {
  it("serves the session's person, in any case, and refuses anyone else or a header that names no one", async () => {
    const f = await fixture();
    const stations = (cookie: string, person?: string) =>
      call(f.app, "/api/stations", cookie, person);

    expect((await stations(f.till.ben, f.ben)).status).toBe(200);
    expect((await stations(f.till.ben, f.ben.toUpperCase())).status).toBe(200);
    expect(await stations(f.till.ben, f.ana)).toMatchObject(refusal(f.ana));
    expect(await stations(f.till.ben, f.ana.toUpperCase())).toMatchObject(refusal(f.ana));
    expect(await stations(f.till.ben, "")).toMatchObject(refusal(null));
    expect(await stations(f.till.ben, "not-an-id")).toMatchObject(refusal(null));
    expect((await stations(f.till.ana, f.ana)).status).toBe(200);
  });

  it("serves a request with no header as before", async () => {
    const f = await fixture();
    expect((await call(f.app, "/api/stations", f.till.ben)).status).toBe(200);
  });

  it("answers session.required, not the person refusal, when the cookie names no open session", async () => {
    const f = await fixture();
    for (const cookie of ["", `${SESSION_COOKIE}=${randomUUID()}`]) {
      expect(await call(f.app, "/api/stations", cookie, f.ana)).toMatchObject({
        status: 401,
        json: { error: { code: "session.required" } },
      });
    }
  });

  it("answers device.unauthorized, not the person refusal, for a revoked device's session", async () => {
    const f = await fixture();
    const revoked = await revokedDeviceSessionCookie(suite.db, f.ben, "4422");
    expect(await call(f.app, "/api/stations", revoked, f.ana)).toMatchObject({
      status: 401,
      json: { error: { code: "device.unauthorized" } },
    });
  });
});

describe("kitchen screens and the person header", () => {
  it("on a till, refuses the station screen's read and a pass release naming someone not signed in", async () => {
    const f = await fixture();
    const station = await f.device("till", { stationId: f.grill });
    expect(await call(f.app, "/api/device/station-screen", station.ben, f.ana)).toMatchObject(
      refusal(f.ana),
    );
    expect((await call(f.app, "/api/device/station-screen", station.ben, f.ben)).status).toBe(200);

    const pass = await f.device("till", { kitchenScreen: { kind: "pass" } });
    expect(
      await call(f.app, "/api/device/pass-screen/release", pass.ben, f.ana, {
        method: "POST",
        body: {},
      }),
    ).toMatchObject(refusal(f.ana));
  });

  it("on a kitchen display, answers a request naming someone not signed in as with nobody signed in", async () => {
    const f = await fixture();
    const station = await f.device("kds", { stationId: f.grill });
    const nobody = await call(f.app, "/api/device/station-screen", station.jar);
    expect(nobody.status).toBe(200);
    expect(await call(f.app, "/api/device/station-screen", station.ben, f.ana)).toEqual(nobody);

    const pass = await f.device("kds", { kitchenScreen: { kind: "pass" } });
    const release = (cookie: string, person?: string) =>
      call(f.app, "/api/device/pass-screen/release", cookie, person, { method: "POST", body: {} });
    const anonymous = await release(pass.jar);
    expect(anonymous).toMatchObject({ status: 400 });
    expect(await release(pass.ben, f.ana)).toEqual(anonymous);
  });
});
