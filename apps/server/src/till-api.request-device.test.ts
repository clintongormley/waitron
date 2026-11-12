import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { clockStartUp } from "./clock-start-up.js";
import { DEV_DEVICE_HEADER, DEVICE_COOKIE } from "./device-session.js";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountScheduleApi } from "./schedule-api.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const id = randomUUID();
const CASES = [
  ["POST", `/api/sales/${id}/receipt/handover`, 404, "working_order.not_found"],
  ["POST", `/api/tables/${id}/cleared`, 404, "table.not_found"],
  ["PUT", `/api/service-zones/${id}/zone-extension`, 400, "management.request_invalid"],
  ["PUT", `/api/stations/${id}/today`, 400, "management.request_invalid"],
  ["PUT", "/api/device/zones", 400, "device_zones.invalid"],
  ["PUT", "/api/device/equipment", 400, "management.request_invalid"],
  ["POST", "/api/device/active-profile", 400, "management.request_invalid"],
  ["POST", "/api/box-clock/challenge", 409, "clock.set_refused"],
  ["POST", "/api/box-clock/confirm", 400, "management.request_invalid"],
  ["POST", "/api/schedule/absences", 400, "management.request_invalid"],
  ["POST", "/api/schedule/swaps", 400, "management.request_invalid"],
  ["POST", `/api/schedule/swaps/${id}/accept`, 404, "swap.not_found"],
  ["PUT", "/api/session/locale", 400, "locale.unsupported"],
] as const;

let venue: PartyVenue;
let sessionCookie: string;
let matching: string;
let foreign: string;
let deviceId: string;
let production: Hono;
let development: Hono;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    const [profile] = await seedDeviceProfiles(db, {
      name: "Preferences only",
      formFactor: "till",
      capabilities: [],
    });
    const device = await enrolDeviceForTest(db, venue.cfg, {
      name: "Signed-in device",
      profileId: profile!.id,
    });
    const other = await enrolDeviceForTest(db, venue.cfg, {
      name: "Other device",
      profileId: profile!.id,
    });
    deviceId = device.deviceId;
    const [admin] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId, personId: admin!.id, pin: "1234" }),
    );
    sessionCookie = `${SESSION_COOKIE}=${session.token}`;
    matching = `${DEVICE_COOKIE}=${deviceId}.${device.token}`;
    foreign = `${DEVICE_COOKIE}=${other.deviceId}.${other.token}`;
    production = mount(false);
    development = mount(true);
  },
});

function mount(devMode: boolean): Hono {
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      backend: venue.backend,
      clock: venue.clock,
      admission: testTradingAdmission(),
      secureCookies: false,
      venueLocale: venue.cfg.locale,
      cardProvider: new SimulatorPaymentProvider(suite.db),
      devMode,
      boxClock: {
        correction: {
          inTurn: async (fn) => fn(),
          set: async () => {
            throw new Error("unexpected clock set");
          },
          steps: () => 0,
        },
        startUp: clockStartUp({ primaryAtStart: true }),
        witnesses: () => [],
        clearWitnesses: () => {},
        readBoot: () => ({ id: "request-device-test", ms: 0 }),
        steady: () => 0,
        requestFromBox: () => false,
        filesRecords: () => true,
      },
    },
    () => {},
  );
  mountDeviceApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      pairingMode: createPairingMode(),
      secureCookies: false,
      devMode,
    },
    () => {},
  );
  mountScheduleApi(app, { db: suite.db, devMode }, () => {});
  return app;
}

async function send(app: Hono, method: string, path: string, proof?: string, header?: string) {
  const response = await app.request(path, {
    method,
    headers: {
      cookie: proof === undefined ? sessionCookie : `${sessionCookie}; ${proof}`,
      "content-type": "application/json",
      ...(header === undefined ? {} : { [DEV_DEVICE_HEADER]: header }),
    },
    body: "{}",
  });
  return { status: response.status, body: await response.json() };
}

// Removing any handler's proof check admits the body/business refusal instead of this exact refusal.
for (const [method, path, status, code] of CASES) {
  describe(`${method} ${path.replaceAll(id, ":id")}`, () => {
    for (const proof of ["absent", "invalid", "foreign"] as const) {
      it(`refuses ${proof} device proof before reading the body`, async () => {
        const cookie =
          proof === "absent"
            ? undefined
            : proof === "foreign"
              ? foreign
              : `${DEVICE_COOKIE}=${deviceId}.wrong-token`;
        expect(await send(production, method, path, cookie)).toEqual({
          status: path.startsWith("/api/box-clock/") ? 403 : 401,
          body: { error: { code: "device.unauthorized", params: {} } },
        });
      });
    }
    it("ignores a development header in production", async () => {
      expect(await send(production, method, path, undefined, deviceId)).toEqual({
        status: path.startsWith("/api/box-clock/") ? 403 : 401,
        body: { error: { code: "device.unauthorized", params: {} } },
      });
    });
    for (const mode of ["cookie", "development header only"] as const) {
      it(`keeps the existing ${code} outcome with matching ${mode} and no selling action`, async () => {
        const result =
          mode === "cookie"
            ? await send(production, method, path, matching)
            : await send(development, method, path, undefined, deviceId);
        expect(result.status).toBe(status);
        expect(result.body.error.code).toBe(code);
      });
    }
  });
}
