import { seedModuleSettings } from "../test/module-settings.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { BoxHostClient } from "./box-host-client.js";
import { menuActivationJob } from "./menu-activation.js";
import { copyMigrationsRoot, tradingBootEnv } from "./testing/boot-trading-fixture.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { deviceCookieForTest } from "./testing/enrol.js";
import { SESSION_COOKIE } from "./till-session.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const seen = vi.hoisted(() => ({
  stops: [] as { calls: number }[],
  watches: [] as { check(): Promise<void> }[],
  readings: [] as { clear(): void }[],
}));

vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    createClockWatch: (...args: Parameters<typeof actual.createClockWatch>) => {
      const watch = actual.createClockWatch(...args);
      const seenStop = { calls: 0 };
      seen.stops.push(seenStop);
      seen.watches.push(watch);
      return {
        ...watch,
        halt: () => {
          seenStop.calls += 1;
          return watch.halt();
        },
      };
    },
  };
});
vi.mock("./clock-service-reading.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-service-reading.js")>();
  return {
    ...actual,
    sharedClockServiceReading: (...args: Parameters<typeof actual.sharedClockServiceReading>) => {
      const reading = actual.sharedClockServiceReading(...args);
      seen.readings.push(reading);
      return reading;
    },
  };
});
vi.mock("./menu-activation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./menu-activation.js")>();
  return { ...actual, menuActivationJob: vi.fn(actual.menuActivationJob) };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
let scratch: string;

beforeEach(async () => {
  seen.stops.length = 0;
  seen.watches.length = 0;
  seen.readings.length = 0;
  vi.mocked(menuActivationJob).mockClear();
  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-watch-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function tradingEnv(seed?: (venue: Venue) => Promise<void>) {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  await seed?.(venue);
  const [port] = await freePorts(1);
  const migrationsRoot = join(scratch, "migrations");
  await copyMigrationsRoot(migrationsRoot);
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  return {
    ...tradingBootEnv(suite.db, scratch, venue.cfg.nodeId, migrationsRoot),
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
  };
}

describe("boot's clock watch", () => {
  it("is started in trading mode and stopped once by close()", async () => {
    const env = await tradingEnv();
    const server = await startServer(env, env);
    try {
      expect(seen.stops).toHaveLength(1);
      expect(seen.stops[0]!.calls).toBe(0);
    } finally {
      await server.close();
    }
    expect(seen.stops[0]!.calls).toBe(1);
  });

  it("is stopped when the start fails after it began", async () => {
    const env = await tradingEnv();
    vi.mocked(menuActivationJob).mockImplementationOnce(() => {
      throw new Error("menu activation failed");
    });
    await expect(startServer(env, env)).rejects.toThrow("menu activation failed");
    expect(seen.stops).toHaveLength(1);
    expect(seen.stops[0]!.calls).toBe(1);
  });

  it("switches a time service found off back on at a look, after a start confirmed by the internet", async () => {
    let service: "on" | "off" = "on";
    const timeServiceOn = vi.fn(async () => ({ available: true as const }));
    const host: BoxHostClient = {
      clockStatus: async () => ({
        available: true,
        service,
        unit: service === "on" ? "chrony.service" : null,
        synchronised: service === "on",
        lastSyncAt: null,
      }),
      setClock: async () => ({ available: false, reason: "missing" }),
      timeServiceOn,
    };
    const env = await tradingEnv();
    const server = await startServer(env, env, { boxHost: host });
    try {
      expect(timeServiceOn).not.toHaveBeenCalled();
      service = "off";
      // A minute passing, without waiting for one: the shared reading forgets its answer.
      expect(seen.readings).toHaveLength(1);
      seen.readings[0]!.clear();
      expect(seen.watches).toHaveLength(1);
      await seen.watches[0]!.check();
      expect(timeServiceOn).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it("serves a till's check of the time, handing the set to the host as a staff member's", async () => {
    const DAY = 24 * 60 * 60_000;
    const sets: Parameters<BoxHostClient["setClock"]>[0][] = [];
    const host: BoxHostClient = {
      clockStatus: async () => ({
        available: true,
        service: "on",
        unit: "chrony.service",
        synchronised: false,
        lastSyncAt: null,
      }),
      // The booted server reads the real clock, which a fake host cannot move.
      setClock: async (input) => {
        sets.push(input);
        return { available: true, beforeMs: Date.now(), afterMs: Date.now() };
      },
    };
    let till: { cookie: string; personId: string; deviceId: string } | undefined;
    const env = await tradingEnv(async () => {
      const [person] = await seedPersons(suite.db, {
        displayName: "Anna",
        pinHash: hashPin("5555"),
        role: "staff",
      });
      const device = await seedDevice(suite.db, {
        capabilities: ["take-orders"],
      });
      const session = await withTransaction(suite.db, (tx) =>
        loginWithPin(tx, { deviceId: device.deviceId, personId: person!.id, pin: "5555" }),
      );
      till = {
        cookie: `${SESSION_COOKIE}=${session.token}; ${await deviceCookieForTest(suite.db, device.deviceId)}`,
        personId: person!.id,
        deviceId: device.deviceId,
      };
    });
    const server = await startServer(env, env, { boxHost: host, requestFromBox: () => false });
    try {
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`http://127.0.0.1:${httpPort()}${path}`, {
          method: "POST",
          headers: { cookie: till!.cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        // An unmounted route answers a plain-text 404.
        const answer = (text.startsWith("{") ? JSON.parse(text) : { text }) as Record<
          string,
          unknown
        >;
        return { status: response.status, body: answer };
      };
      const rows = () =>
        suite.db.all<{ n: number }>(
          sql`select count(*) as n from verifactu_history where kind = 'clock.confirmed'`,
        )[0]!.n;
      const before = rows();
      const asked = await post("/api/box-clock/challenge", {});
      expect(asked.status).toBe(200);
      const deviceAt = Date.now() + DAY;
      const confirmed = await post("/api/box-clock/confirm", {
        challengeId: asked.body.challengeId,
        deviceAt,
      });
      expect(confirmed).toEqual({
        status: 502,
        body: { error: { code: "clock.set_failed", params: { reason: "refused" } } },
      });
      expect(sets).toHaveLength(1);
      expect(sets[0]!.requester).toEqual({
        source: "staff",
        person: till!.personId,
        device: till!.deviceId,
      });
      expect(Math.abs(sets[0]!.targetMs - deviceAt)).toBeLessThan(60_000);
      expect(rows()).toBe(before);
    } finally {
      await server.close();
    }
  });
});
