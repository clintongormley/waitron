import { beforeEach, expect, it } from "vitest";
import { Hono } from "hono";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { DEV_DEVICE_HEADER } from "./device-session.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import { systemClock } from "./till-backend.js";
import { mountTillApi } from "./till-api.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: ClockVenue;

beforeEach(async () => {
  venue = await createClockVenue(suite.db, () => new Date("2026-01-05T09:00:00Z"));
});

function tillApp(devMode: boolean): Hono {
  const clock = systemClock();
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      backend: new VerifactuBackend({
        db: suite.db,
        clock,
        environment: "preproduction",
        deploymentEnvironment: "preproduction",
      }),
      clock,
      cfg: venue.cfg,
      secureCookies: false,
      venueLocale: "es-ES",
      devMode,
      workforceEnabled: true,
    },
    () => {},
  );
  return app;
}

async function headerOnly(app: Hono, path: string): Promise<Response> {
  const sessionOnly = venue.cookie.split("; ")[0]!.replace("=", `_${venue.deviceId}=`);
  return await app.request(path, {
    headers: { cookie: sessionOnly, [DEV_DEVICE_HEADER]: venue.deviceId },
  });
}

for (const path of ["/api/clock/state", "/api/attendance/inbox"]) {
  it(`answers ${path} for a device proven by the development header alone`, async () => {
    const response = await headerOnly(tillApp(true), path);
    expect(response.status, JSON.stringify(await response.json())).toBe(200);
  });

  it(`ignores the development header on ${path} outside development`, async () => {
    const response = await headerOnly(tillApp(false), path);
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 403,
      body: { error: { code: "device.unauthorized", params: {} } },
    });
  });
}
