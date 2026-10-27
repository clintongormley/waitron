import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import type { DeviceApiDeps } from "./device-api.js";
import type { DiskFullState } from "./disk-full-state.js";
import type { TillApiDeps } from "./till-api.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();

const seen = vi.hoisted(() => ({
  stores: [] as unknown[],
  created: [] as { deps: { dir: string }; state: unknown }[],
  watched: [] as { state: unknown; stores: readonly unknown[] }[],
  unsubscribed: 0,
  noted: [] as { state: unknown; deps: { dir: string } }[],
  tillDeps: [] as unknown[],
  billDeps: [] as unknown[],
  deviceDeps: [] as unknown[],
  scheduleDeps: [] as unknown[],
  failMountTillApi: false,
}));

vi.mock("@waitron/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/db")>();
  return {
    ...actual,
    openVenueDatabase: async (...args: Parameters<typeof actual.openVenueDatabase>) => {
      const store = await actual.openVenueDatabase(...args);
      seen.stores.push(store);
      return store;
    },
  };
});
vi.mock("./disk-full-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./disk-full-state.js")>();
  return {
    ...actual,
    createDiskFullState: (deps: Parameters<typeof actual.createDiskFullState>[0]) => {
      const state = actual.createDiskFullState(deps);
      seen.created.push({ deps, state });
      return state;
    },
    watchForDiskFull: (...args: Parameters<typeof actual.watchForDiskFull>) => {
      seen.watched.push({ state: args[0], stores: args[1] });
      const unsubscribe = actual.watchForDiskFull(...args);
      return () => {
        seen.unsubscribed += 1;
        unsubscribe();
      };
    },
    noteFullAtStart: async (...args: Parameters<typeof actual.noteFullAtStart>) => {
      seen.noted.push({ state: args[0], deps: args[1] });
      return actual.noteFullAtStart(...args);
    },
  };
});
vi.mock("./till-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./till-api.js")>();
  return {
    ...actual,
    mountTillApi: (...args: Parameters<typeof actual.mountTillApi>) => {
      seen.tillDeps.push(args[1]);
      if (seen.failMountTillApi) throw new Error("a step after the disk wiring failed");
      return actual.mountTillApi(...args);
    },
  };
});
vi.mock("./bill-payments-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bill-payments-api.js")>();
  return {
    ...actual,
    mountBillPaymentsApi: (...args: Parameters<typeof actual.mountBillPaymentsApi>) => {
      seen.billDeps.push(args[1]);
      return actual.mountBillPaymentsApi(...args);
    },
  };
});

vi.mock("./device-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./device-api.js")>();
  return {
    ...actual,
    mountDeviceApi: (...args: Parameters<typeof actual.mountDeviceApi>) => {
      seen.deviceDeps.push(args[1]);
      return actual.mountDeviceApi(...args);
    },
  };
});
vi.mock("./schedule-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./schedule-api.js")>();
  return {
    ...actual,
    mountScheduleApi: (...args: Parameters<typeof actual.mountScheduleApi>) => {
      seen.scheduleDeps.push(args[1]);
      return actual.mountScheduleApi(...args);
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

async function startEnv(scratch: string) {
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
  const venueDir = dirname(database);
  const env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
    WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
  };
  return { env, venueDir };
}

beforeEach(() => {
  seen.stores.length = 0;
  seen.created.length = 0;
  seen.watched.length = 0;
  seen.unsubscribed = 0;
  seen.noted.length = 0;
  seen.tillDeps.length = 0;
  seen.billDeps.length = 0;
  seen.deviceDeps.length = 0;
  seen.scheduleDeps.length = 0;
  seen.failMountTillApi = false;
});

describe("boot's full-disk stop wiring", () => {
  it("listens to both of the venue folder's files, reads its free space, and hands the stop to the till routes", async () => {
    beforeServerStarts();
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
    let server: StartedServer | undefined;
    try {
      const { env, venueDir } = await startEnv(scratch);
      server = await startServer(env, env);

      expect(seen.created).toHaveLength(1);
      const { deps: createdWith, state } = seen.created[0]!;
      expect(createdWith.dir).toBe(venueDir);

      expect(seen.tillDeps).toHaveLength(1);
      const tillDeps = seen.tillDeps[0] as TillApiDeps;
      const s = seen.stores.find((store) => (store as VenueDatabase).venue === tillDeps.db) as
        VenueDatabase | undefined;
      expect(s).toBeDefined();

      expect(seen.watched).toHaveLength(1);
      expect(seen.watched[0]!.state).toBe(state);
      expect(seen.watched[0]!.stores).toHaveLength(2);
      expect(seen.watched[0]!.stores[0]).toBe(s!.venue);
      expect(seen.watched[0]!.stores[1]).toBe(s!.node);

      expect(seen.noted).toHaveLength(1);
      expect(seen.noted[0]!.state).toBe(state);
      expect(seen.noted[0]!.deps.dir).toBe(venueDir);

      expect(tillDeps.disk).toBe(state);
      expect(seen.billDeps).toHaveLength(1);
      expect((seen.billDeps[0] as { disk?: DiskFullState }).disk).toBe(state);
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("hands the stop to the kitchen screens' and the schedule's routes", async () => {
    beforeServerStarts();
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
    let server: StartedServer | undefined;
    try {
      const { env } = await startEnv(scratch);
      server = await startServer(env, env);
      expect(seen.created).toHaveLength(1);
      const { state } = seen.created[0]!;
      expect(seen.deviceDeps).toHaveLength(1);
      expect((seen.deviceDeps[0] as { disk?: DiskFullState }).disk).toBe(state);
      expect(seen.scheduleDeps).toHaveLength(1);
      expect((seen.scheduleDeps[0] as { disk?: DiskFullState }).disk).toBe(state);
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each([
    { extra: {}, filing: false },
    { extra: { WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" }, filing: true },
  ])(
    "hands the equipment read the box's notice over the same stop, the enabled modules' sources and filing: $filing",
    async ({ extra, filing }) => {
      beforeServerStarts();
      const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
      let server: StartedServer | undefined;
      try {
        const { env } = await startEnv(scratch);
        server = await startServer({ ...env, ...extra }, { ...env, ...extra });
        const state = seen.created[0]!.state as DiskFullState;
        const notices = (seen.deviceDeps[0] as DeviceApiDeps).notices!;
        expect(notices.sources.map(({ owner }) => owner)).toEqual(["box", "fiscal-verifactu"]);
        expect(notices.filing()).toEqual({ enabled: filing });
        const reading = notices.clock.now();
        const box = notices.sources[0]!.source;
        const ask = () => box.read({ tx: suite.db, reading });
        expect(await ask()).toEqual([]);
        state.noteRefused();
        expect((await ask()).map(({ key }) => key)).toEqual(["storage.disk_full"]);
      } finally {
        await server?.close();
        await rm(scratch, { recursive: true, force: true });
      }
    },
  );

  it("a refused start stops listening", async () => {
    beforeServerStarts();
    seen.failMountTillApi = true;
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
    try {
      const { env } = await startEnv(scratch);
      await expect(startServer(env, env)).rejects.toThrow("a step after the disk wiring failed");
      expect(seen.watched).toHaveLength(1);
      expect(seen.unsubscribed).toBe(1);
    } finally {
      seen.failMountTillApi = false;
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
