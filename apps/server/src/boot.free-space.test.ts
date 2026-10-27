import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import type { DiskFullState } from "./disk-full-state.js";
import type { startFreeSpaceWatch } from "./free-space-watch.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import type { Alert } from "@waitron/module";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const GIB = 1024 ** 3;

const holder = vi.hoisted(() => ({
  free: 0,
  deps: undefined as Parameters<typeof startFreeSpaceWatch>[0] | undefined,
  armed: [] as (() => void)[],
}));

// Boot has no free-space seam; keep its real watch and the state and stop boot hands it, and
// replace only the filesystem reading and the timer.
vi.mock("./free-space-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./free-space-watch.js")>();
  return {
    ...actual,
    startFreeSpaceWatch: (deps: Parameters<typeof actual.startFreeSpaceWatch>[0]) => {
      holder.deps = deps;
      return actual.startFreeSpaceWatch({
        ...deps,
        statfs: async () => ({ bavail: holder.free, frsize: 1 }),
        timer: (_ms, fn) => {
          holder.armed.push(fn);
          return { cancel: () => {} };
        },
      });
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

async function tick(): Promise<void> {
  const n = holder.armed.length;
  holder.armed.at(-1)!();
  await vi.waitFor(() => expect(holder.armed.length).toBe(n + 1));
}

describe("the running server's free-space watch", () => {
  it("the bell shows the box's disk, and a full-disk stop lifts on the watch's next reading", async () => {
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-free-space-"));
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
      const env = {
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_STATE_DIR: scratch,
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
        WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      };
      holder.free = GIB;
      server = await startServer(env, env);
      await vi.waitFor(async () => {
        expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
      });
      const boxAlerts = async () => {
        const response = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
          headers: { cookie: venue.managerCookie },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { alerts: Alert[] };
        return body.alerts.filter((alert) => alert.area === "box");
      };
      const spaceLow = {
        key: "storage.space_low",
        code: "storage.space_low",
        params: { freeBytes: GIB },
        severity: "warning",
        since: expect.any(String),
        kind: "ongoing",
        area: "box",
        screen: "box-status",
      };

      await tick();
      expect(await boxAlerts()).toEqual([spaceLow]);
      expect(holder.deps!.dir).toBe(env.WAITRON_VENUE_DIR);

      const disk = holder.deps!.disk as DiskFullState;
      disk.noteRefused();
      expect(await boxAlerts()).toEqual([
        {
          key: "storage.disk_full",
          code: "storage.disk_full",
          params: {},
          severity: "error",
          since: expect.any(String),
          kind: "ongoing",
          area: "box",
          screen: "box-status",
        },
      ]);

      // The stop re-reads the real venue folder, which has room.
      await tick();
      expect(await boxAlerts()).toEqual([spaceLow]);
      expect(disk.noted()).toBe(false);

      holder.free = 3 * GIB;
      await tick();
      expect(await boxAlerts()).toEqual([]);
    } finally {
      if (server !== undefined) await server.close();
      holder.deps = undefined;
      holder.armed.length = 0;
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
