import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSingletonRoleTx, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { AuthorityTimeSample } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ClockStartUp } from "./clock-start-up.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const seen = vi.hoisted(() => ({
  order: [] as string[],
  startUps: [] as { input: { primaryAtStart: boolean }; window: unknown }[],
  noticeBoxes: [] as Record<string, unknown>[],
  watchStartUps: [] as unknown[],
  watchArgs: [] as Record<string, unknown>[],
  checkArgs: [] as Record<string, unknown>[],
  notedAuthority: [] as unknown[],
  onSamples: [] as (((sample: unknown) => void) | undefined)[],
  stopReaders: [] as Record<string, unknown>[],
}));

vi.mock("./clock-start-up.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-start-up.js")>();
  return {
    ...actual,
    clockStartUp: (input: { primaryAtStart: boolean }) => {
      seen.order.push("clockStartUp");
      const real = actual.clockStartUp(input);
      const window = { ...real, authorityAsked: vi.fn(real.authorityAsked) };
      seen.startUps.push({ input, window });
      return window;
    },
    tillClockCheck: (...args: Parameters<typeof actual.tillClockCheck>) => {
      seen.checkArgs.push(args[0] as unknown as Record<string, unknown>);
      return actual.tillClockCheck(...args);
    },
  };
});

vi.mock("./box-staff-notices.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./box-staff-notices.js")>();
  return {
    ...actual,
    deviceNoticeSources: (...args: Parameters<typeof actual.deviceNoticeSources>) => {
      seen.order.push("deviceNoticeSources");
      seen.noticeBoxes.push(args[0] as Record<string, unknown>);
      return actual.deviceNoticeSources(...args);
    },
  };
});

vi.mock("./box-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./box-health.js")>();
  return {
    ...actual,
    clockStopReader: (...args: Parameters<typeof actual.clockStopReader>) => {
      seen.stopReaders.push(args[0] as unknown as Record<string, unknown>);
      return actual.clockStopReader(...args);
    },
  };
});

vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    startClockWatch: (...args: Parameters<typeof actual.startClockWatch>) => {
      seen.watchStartUps.push(args[0].startUp);
      seen.watchArgs.push(args[0] as unknown as Record<string, unknown>);
      return actual.startClockWatch(...args);
    },
  };
});

vi.mock("./clock-witnesses.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-witnesses.js")>();
  return {
    ...actual,
    createClockWitnessStore: (...args: Parameters<typeof actual.createClockWitnessStore>) => {
      const store = actual.createClockWitnessStore(...args);
      return {
        ...store,
        noteAuthority: (sample: Parameters<typeof store.noteAuthority>[0]) => {
          seen.notedAuthority.push(sample);
          store.noteAuthority(sample);
        },
      };
    },
  };
});

vi.mock("./time-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./time-health.js")>();
  return {
    ...actual,
    createAuthorityClockStatus: (...args: Parameters<typeof actual.createAuthorityClockStatus>) => {
      seen.onSamples.push(args[0]?.onSample as ((sample: unknown) => void) | undefined);
      return actual.createAuthorityClockStatus(...args);
    },
  };
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
let scratch: string;

beforeEach(async () => {
  seen.order.length = 0;
  seen.startUps.length = 0;
  seen.noticeBoxes.length = 0;
  seen.watchStartUps.length = 0;
  seen.watchArgs.length = 0;
  seen.checkArgs.length = 0;
  seen.notedAuthority.length = 0;
  seen.onSamples.length = 0;
  seen.stopReaders.length = 0;
  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-start-up-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function tradingEnv(role: "primary" | "secondary") {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  if (role === "secondary") {
    await stampDeployment(suite.db, "preproduction");
    await withTransaction(suite.db, (tx) => setSingletonRoleTx(tx, venue.cfg.nodeId, "secondary"));
  }
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
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
  };
}

describe("boot's clock start-up window", () => {
  it("is opened on a primary before the tills' notice sources and handed to the watch, the tills and Box status's clock read", async () => {
    const env = await tradingEnv("primary");
    const server = await startServer(env, env);
    try {
      expect(seen.startUps).toHaveLength(1);
      expect(seen.startUps[0]!.input).toEqual({ primaryAtStart: true });
      const window = seen.startUps[0]!.window as ClockStartUp;
      expect(seen.order.slice(0, 2)).toEqual(["clockStartUp", "deviceNoticeSources"]);
      // The tills' equipment read first, then the Box status page's.
      expect(seen.noticeBoxes).toHaveLength(2);
      expect(seen.noticeBoxes[0]!.clockCheck).toBeTypeOf("function");
      expect(seen.noticeBoxes[1]!.clockCheck).toBeUndefined();
      expect(seen.watchStartUps).toEqual([window]);
      // The till's check reads the same window, seat and filing switch as the watch.
      expect(seen.checkArgs).toHaveLength(1);
      expect(seen.checkArgs[0]!.startUp).toBe(window);
      expect(seen.checkArgs[0]!.backend).toBe(seen.watchArgs[0]!.backend);
      expect(seen.checkArgs[0]!.filesRecords).toBe(seen.watchArgs[0]!.filesRecords);
      // Box status words a devices-only proof by the window the watch acts on.
      expect(seen.stopReaders).toHaveLength(1);
      expect(seen.stopReaders[0]!.startUp).toBe(window);

      expect(seen.onSamples).toHaveLength(1);
      const sample: AuthorityTimeSample = {
        authorityMs: Date.now(),
        uncertaintyMs: 100,
        at: { wallMs: Date.now(), monoMs: 1_000 },
      };
      seen.onSamples[0]!(sample);
      expect(window.authorityAsked).toHaveBeenCalledExactlyOnceWith(true);
      expect(seen.notedAuthority).toEqual([sample]);
    } finally {
      await server.close();
    }
  });

  it("is created closed on a node whose singleton role at its start is not primary", async () => {
    const env = await tradingEnv("secondary");
    const server = await startServer(env, env);
    try {
      expect(seen.startUps).toHaveLength(1);
      expect(seen.startUps[0]!.input).toEqual({ primaryAtStart: false });
    } finally {
      await server.close();
    }
  });
});
