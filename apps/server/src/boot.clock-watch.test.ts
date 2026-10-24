import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startMenuActivation } from "./menu-activation.js";
import { serverFixture } from "./testing/server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

const { beforeServerStarts, startServer } = serverFixture();

const seen = vi.hoisted(() => ({
  stops: [] as { calls: number }[],
}));

vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    startClockWatch: (...args: Parameters<typeof actual.startClockWatch>) => {
      const watch = actual.startClockWatch(...args);
      const seenStop = { calls: 0 };
      seen.stops.push(seenStop);
      return {
        stop: () => {
          seenStop.calls += 1;
          return watch.stop();
        },
      };
    },
  };
});
vi.mock("./menu-activation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./menu-activation.js")>();
  return { ...actual, startMenuActivation: vi.fn(actual.startMenuActivation) };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
let scratch: string;

beforeEach(async () => {
  seen.stops.length = 0;
  vi.mocked(startMenuActivation).mockClear();
  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-watch-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function tradingEnv() {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const [port] = await freePorts(1);
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  return {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
    WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
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
    vi.mocked(startMenuActivation).mockImplementationOnce(() => {
      throw new Error("menu activation failed");
    });
    await expect(startServer(env, env)).rejects.toThrow("menu activation failed");
    expect(seen.stops).toHaveLength(1);
    expect(seen.stops[0]!.calls).toBe(1);
  });
});
