import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deviceProfiles } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  PIN_THROTTLE_FREE_ATTEMPTS,
  createPinThrottle,
  hashPin,
  persons,
  type PinThrottle,
} from "@waitron/identity";
import { DEVICE_COOKIE } from "./device-session.js";
import { mountTillApi } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import {
  watchDerivations,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";
import "./errors.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

let v: PartyVenue;

beforeAll(async () => {
  v = await setupPartyVenue(suite.db);
});

function mountApp(pinThrottle?: PinThrottle): Hono {
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      pinThrottle,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  return app;
}

async function tillCookie(): Promise<string> {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${randomUUID()}`, formFactor: "till", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Till ${randomUUID()}`,
    profileId: profile!.id,
  });
  return `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
}

async function person(pin: string): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: `Staff ${randomUUID()}`, pinHash: hashPin(pin), role: "staff" })
    .returning({ id: persons.id });
  return row!.id;
}

async function signIn(app: Hono, cookie: string, body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

const THROTTLED = { error: { code: "pin.throttled", params: { retryAfterSeconds: 2 } } };

describe("POST /api/session PIN checks", () => {
  afterEach(async () => {
    await watchedOrder();
  });

  it.each([
    ["a number", { pin: 5555 }],
    ["null", { pin: null }],
    ["missing", {}],
    ["an object", { pin: { pin: "5555" } }],
    ["an array", { pin: ["5555"] }],
  ])("refuses a PIN that is %s as pin.invalid and counts it as a wrong PIN", async (_, extra) => {
    const app = mountApp(createPinThrottle({ now: () => 1_000_000 }));
    const cookie = await tillCookie();
    const personId = await person("5555");

    for (let attempt = 0; attempt <= PIN_THROTTLE_FREE_ATTEMPTS; attempt++) {
      const res = await signIn(app, cookie, { personId, ...extra });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "pin.invalid", params: {} } });
    }

    const correct = await signIn(app, cookie, { personId, pin: "5555" });
    expect(correct.status).toBe(429);
    expect(await correct.json()).toEqual(THROTTLED);
  });

  it("answers a correct PIN already deriving its key before non-text PINs sent meanwhile", async () => {
    const app = mountApp(createPinThrottle({ now: () => 1_000_000 }));
    const cookie = await tillCookie();
    const personId = await person("4321");
    let malformed: Promise<Response>[] = [];
    // The non-text attempts wait for this derivation's turn, so the watcher's one-second fallback ends it.
    watchDerivations("4321", () => {
      malformed = [{ pin: 5555 }, { pin: null }, {}, { pin: ["4321"] }, { pin: {} }].map((extra) =>
        signIn(app, cookie, { personId, ...extra }),
      );
      return Promise.all(malformed);
    });

    const correct = await signIn(app, cookie, { personId, pin: "4321" });
    const refused = await Promise.all(malformed);

    expect(correct.status).toBe(200);
    const bodies = await Promise.all(refused.map(async (res) => [res.status, await res.json()]));
    expect(bodies.sort(([a], [b]) => Number(a) - Number(b))).toEqual([
      ...Array.from({ length: PIN_THROTTLE_FREE_ATTEMPTS + 1 }, () => [
        401,
        { error: { code: "pin.invalid", params: {} } },
      ]),
      [429, THROTTLED],
    ]);
    expect(watchedDerivationCount()).toBe(1);
  });

  it("derives a key only for the attempts the slow-down lets through when eight arrive at once", async () => {
    const app = mountApp(createPinThrottle({ now: () => 1_000_000 }));
    const cookie = await tillCookie();
    const personId = await person("5555");
    watchDerivations("9999");

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => signIn(app, cookie, { personId, pin: "9999" })),
    );

    const statuses = responses.map((res) => res.status);
    const allowed = PIN_THROTTLE_FREE_ATTEMPTS + 1;
    expect(statuses.filter((status) => status === 401)).toHaveLength(allowed);
    expect(statuses.filter((status) => status === 429)).toHaveLength(8 - allowed);
    for (const res of responses.filter((res) => res.status === 429)) {
      expect(await res.json()).toEqual(THROTTLED);
    }
    expect(watchedDerivationCount()).toBe(allowed);
  });

  it("signs in with one correct PIN, deriving its key once", async () => {
    const app = mountApp();
    const cookie = await tillCookie();
    const personId = await person("4321");
    watchDerivations("4321");

    const res = await signIn(app, cookie, { personId, pin: "4321" });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/waitron_till_session=/);
    expect(watchedDerivationCount()).toBe(1);
  });

  it("signs in two different people at once on the same till", async () => {
    const app = mountApp();
    const cookie = await tillCookie();
    const first = await person("1357");
    const second = await person("2468");

    const [a, b] = await Promise.all([
      signIn(app, cookie, { personId: first, pin: "1357" }),
      signIn(app, cookie, { personId: second, pin: "2468" }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect([
      ((await a.json()) as { personId: string }).personId,
      ((await b.json()) as { personId: string }).personId,
    ]).toEqual([first, second]);
  });
});
