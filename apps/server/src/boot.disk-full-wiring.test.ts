import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SPARE_SPACE_FILE, SPARE_SPACE_RELEASED_FILE } from "@waitron/provisioning";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import type { Statfs } from "./free-bytes.js";
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
  noted: [] as { state: unknown; deps: { dir: string }; notedAfter: boolean; fullAfter: boolean }[],
  tillDeps: [] as unknown[],
  billDeps: [] as unknown[],
  deviceDeps: [] as unknown[],
  scheduleDeps: [] as unknown[],
  freers: [] as ((personId: string) => Promise<unknown>)[],
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
      const result = await actual.noteFullAtStart(...args);
      // Read here, before the free-space watch starts and can write the spare back.
      const notedAfter = args[0].noted();
      const fullAfter = await args[0].full();
      seen.noted.push({ state: args[0], deps: args[1], notedAfter, fullAfter });
      return result;
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

vi.mock("./free-space-now.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./free-space-now.js")>();
  return {
    ...actual,
    createSpaceFreer: (...args: Parameters<typeof actual.createSpaceFreer>) => {
      const freer = actual.createSpaceFreer(...args);
      seen.freers.push(freer);
      return freer;
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
    WAITRON_NODE_ID: venue.cfg.nodeId,
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
  seen.freers.length = 0;
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

  it("a marker in the state folder notes the stop at start with plenty of room", async () => {
    beforeServerStarts();
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
    let server: StartedServer | undefined;
    try {
      const { env } = await startEnv(scratch);
      await writeFile(join(scratch, SPARE_SPACE_RELEASED_FILE), "");
      server = await startServer(env, env, { spareBytes: 4096 });
      expect(seen.noted).toHaveLength(1);
      expect(seen.noted[0]!.notedAfter).toBe(true);
      // The temporary folder has far more than 16 MiB free: only the marker keeps the stop.
      expect(seen.noted[0]!.fullAfter).toBe(true);
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("the spare's folder is WAITRON_SPARE_SPACE_DIR when it is set", async () => {
    beforeServerStarts();
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
    const spareDir = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-spare-"));
    let server: StartedServer | undefined;
    try {
      const { env } = await startEnv(scratch);
      await writeFile(join(spareDir, SPARE_SPACE_RELEASED_FILE), "");
      const withSpare = { ...env, WAITRON_SPARE_SPACE_DIR: spareDir };
      server = await startServer(withSpare, withSpare, { spareBytes: 4096 });
      expect(seen.noted).toHaveLength(1);
      expect(seen.noted[0]!.notedAfter).toBe(true);
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
      await rm(spareDir, { recursive: true, force: true });
    }
  });

  it("with WAITRON_SPARE_SPACE_DIR set, a marker in the state folder notes nothing", async () => {
    beforeServerStarts();
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
    const spareDir = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-spare-"));
    let server: StartedServer | undefined;
    try {
      const { env } = await startEnv(scratch);
      await writeFile(join(scratch, SPARE_SPACE_RELEASED_FILE), "");
      const withSpare = { ...env, WAITRON_SPARE_SPACE_DIR: spareDir };
      server = await startServer(withSpare, withSpare, { spareBytes: 4096 });
      expect(seen.noted).toHaveLength(1);
      expect(seen.noted[0]!.notedAfter).toBe(false);
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
      await rm(spareDir, { recursive: true, force: true });
    }
  });

  describe("the running box writes a released spare back", () => {
    const SPARE = 4096;
    /** A free-space stub for the watch and its room check, recording each folder it is asked about. */
    function stubbed(bytes: number) {
      const asked: string[] = [];
      const free = { bytes };
      const statfs: Statfs = async (dir) => {
        asked.push(dir);
        return { bavail: free.bytes, frsize: 1 };
      };
      const count = (dir: string) => asked.filter((seenDir) => seenDir === dir).length;
      return { statfs, count, free };
    }

    async function booted(
      free: number,
      withMarker: boolean,
      options: { spareDir?: string; intervalMs?: number } = {},
    ) {
      beforeServerStarts();
      const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-"));
      const { env: base, venueDir } = await startEnv(scratch);
      const env = options.spareDir ? { ...base, WAITRON_SPARE_SPACE_DIR: options.spareDir } : base;
      const markerDir = options.spareDir ?? scratch;
      if (withMarker) await writeFile(join(markerDir, SPARE_SPACE_RELEASED_FILE), "");
      const stub = stubbed(free);
      const server = await startServer(env, env, {
        spareBytes: SPARE,
        freeSpaceWatch: { intervalMs: options.intervalMs ?? 50, statfs: stub.statfs },
      });
      return { scratch, venueDir, server, stub };
    }

    it("with WAITRON_SPARE_SPACE_DIR set, the watch writes the spare back in that folder and deletes the marker there", async () => {
      const spareDir = await mkdtemp(join(tmpdir(), "waitron-boot-disk-full-wiring-spare-"));
      const { scratch, server } = await booted(SPARE + FULL_DISK_BYTES, true, { spareDir });
      try {
        await vi.waitFor(
          async () => {
            expect((await stat(join(spareDir, SPARE_SPACE_FILE))).size).toBe(SPARE);
            expect(existsSync(join(spareDir, SPARE_SPACE_RELEASED_FILE))).toBe(false);
          },
          { timeout: 10_000 },
        );
        expect(existsSync(join(scratch, SPARE_SPACE_FILE))).toBe(false);
      } finally {
        await server.close();
        await rm(scratch, { recursive: true, force: true });
        await rm(spareDir, { recursive: true, force: true });
      }
    });

    it("Box status's Free writes a released spare back once there is room, before the watch's next reading", async () => {
      const { scratch, server, stub } = await booted(SPARE + FULL_DISK_BYTES - 1, true, {
        intervalMs: 3_600_000,
      });
      try {
        await vi.waitFor(() => expect(stub.count(scratch)).toBeGreaterThanOrEqual(1), {
          timeout: 10_000,
        });
        expect(existsSync(join(scratch, SPARE_SPACE_FILE))).toBe(false);
        stub.free.bytes = SPARE + FULL_DISK_BYTES;
        expect(seen.freers).toHaveLength(1);
        await seen.freers[0]!("person-1");
        expect((await stat(join(scratch, SPARE_SPACE_FILE))).size).toBe(SPARE);
        expect(existsSync(join(scratch, SPARE_SPACE_RELEASED_FILE))).toBe(false);
      } finally {
        await server.close();
        await rm(scratch, { recursive: true, force: true });
      }
    });

    it("the watch writes a released spare back once exactly the spare plus 16 MiB is free, deletes the marker, and the stop lifts", async () => {
      const { scratch, server } = await booted(SPARE + FULL_DISK_BYTES, true);
      try {
        const state = seen.created[0]!.state as DiskFullState;
        await vi.waitFor(
          async () => {
            expect((await stat(join(scratch, SPARE_SPACE_FILE))).size).toBe(SPARE);
            expect(existsSync(join(scratch, SPARE_SPACE_RELEASED_FILE))).toBe(false);
            expect(state.noted()).toBe(false);
          },
          { timeout: 10_000 },
        );
        expect(await readFile(join(scratch, "logs", "waitron.log"), "utf8")).toContain(
          "storage.spare_restored",
        );
      } finally {
        await server.close();
        await rm(scratch, { recursive: true, force: true });
      }
    });

    it("the watch writes nothing back at one byte under the spare plus 16 MiB", async () => {
      const { scratch, server, stub } = await booted(SPARE + FULL_DISK_BYTES - 1, true);
      try {
        await vi.waitFor(() => expect(stub.count(scratch)).toBeGreaterThanOrEqual(3), {
          timeout: 10_000,
        });
        expect(existsSync(join(scratch, SPARE_SPACE_FILE))).toBe(false);
        expect(existsSync(join(scratch, SPARE_SPACE_RELEASED_FILE))).toBe(true);
      } finally {
        await server.close();
        await rm(scratch, { recursive: true, force: true });
      }
    });

    it("the watch writes nothing back while no marker exists", async () => {
      const { scratch, venueDir, server, stub } = await booted(1024 ** 3, false);
      try {
        await vi.waitFor(() => expect(stub.count(venueDir)).toBeGreaterThanOrEqual(3), {
          timeout: 10_000,
        });
        expect(existsSync(join(scratch, SPARE_SPACE_FILE))).toBe(false);
        expect(stub.count(scratch)).toBe(0);
      } finally {
        await server.close();
        await rm(scratch, { recursive: true, force: true });
      }
    });
  });

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
