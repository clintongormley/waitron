import { randomUUID } from "node:crypto";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { DEVICE_COOKIE } from "./device-session.js";
import { mountTillApi } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { freePorts } from "./testing/free-ports.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

let venue: PartyVenue;
let server: ServerType | undefined;
let origin: string;
let sessionCookie: string;
let deviceCookie: string;
let otherDeviceCookie: string;

afterAll(async () => {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

beforeAll(async () => {
  venue = await setupPartyVenue(suite.db);
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
      secureCookies: false,
      venueLocale: venue.cfg.locale,
      cardProvider: new SimulatorPaymentProvider(suite.db),
    },
    () => {},
  );
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Order profile", formFactor: "till", capabilities: [...CAPABILITY_FLAGS] })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Order till",
    profileId: profile!.id,
  });
  const other = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Other till",
    profileId: profile!.id,
  });
  deviceCookie = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  otherDeviceCookie = `${DEVICE_COOKIE}=${other.deviceId}.${other.token}`;
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Order administrator", role: "admin", pinHash: hashPin("5555") })
    .returning({ id: persons.id });
  const [port] = await freePorts(1);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: port! }, () => resolve());
  });
  origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: person!.id, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  await login.arrayBuffer();
}, 120_000);

async function place(cookie: string, id: string): Promise<Response> {
  return fetch(`${origin}/api/working-orders`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      id,
      zoneId: venue.counter.zoneId,
      lines: [{ menuItemId: venue.counterItem("Burger"), quantity: "1" }],
    }),
  });
}

describe("till action device proof over HTTP", () => {
  it("keeps session-only order reads available without a device cookie", async () => {
    const answer = await fetch(`${origin}/api/working-orders`, {
      headers: { cookie: sessionCookie },
    });
    expect(answer.status).toBe(200);
    await answer.arrayBuffer();
  });

  it("serves a real PIN session with its matching enrolled device", async () => {
    const id = randomUUID();
    const answer = await place(`${sessionCookie}; ${deviceCookie}`, id);
    expect(answer.status).toBe(200);
    await answer.arrayBuffer();
    expect(
      await suite.db.all<{ id: string }>(sql`select id from working_orders where id = ${id}`),
    ).toEqual([{ id }]);
  });

  it.each(["missing", "malformed", "other-device", "wrong-token"] as const)(
    "refuses %s device proof before creating an order",
    async (kind) => {
      const id = randomUUID();
      const cookies = {
        missing: sessionCookie,
        malformed: `${sessionCookie}; ${DEVICE_COOKIE}=invalid`,
        "other-device": `${sessionCookie}; ${otherDeviceCookie}`,
        "wrong-token": `${sessionCookie}; ${deviceCookie.slice(0, deviceCookie.lastIndexOf(".") + 1)}wrong`,
      };
      const cookie = cookies[kind];
      const answer = await place(cookie, id);
      const body = (await answer.json()) as { error?: { code: string } };
      expect({ status: answer.status, code: body.error?.code }).toEqual({
        status: 401,
        code: "device.unauthorized",
      });
      expect(
        await suite.db.all<{ id: string }>(sql`select id from working_orders where id = ${id}`),
      ).toEqual([]);
    },
  );
});
