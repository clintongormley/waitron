import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setDeploymentMode,
  stampDeployment,
  writeMirrorConfig,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import type { BackupSupervisorDeps } from "./backup-supervisor.js";
import type { BoxHealth } from "./box-health.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { awaitListening } from "./testing/boot-harness.js";
import { serverFixture } from "./testing/server-fixture.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const holder = vi.hoisted(() => ({
  supervisorDeps: undefined as BackupSupervisorDeps | undefined,
}));

vi.mock("./backup-supervisor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backup-supervisor.js")>();
  class KeptBackupSupervisor extends actual.BackupSupervisor {
    constructor(deps: BackupSupervisorDeps) {
      super(deps);
      holder.supervisorDeps = deps;
    }
  }
  return { ...actual, BackupSupervisor: KeptBackupSupervisor };
});

vi.mock("./time-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./time-health.js")>();
  return { ...actual, checkTimeHealth: vi.fn(actual.checkTimeHealth) };
});

vi.mock("./disk-usage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./disk-usage.js")>();
  return { ...actual, readDiskUsage: vi.fn(actual.readDiskUsage) };
});

const { checkTimeHealth } = await import("./time-health.js");
const { readDiskUsage } = await import("./disk-usage.js");

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const { beforeServerStarts, startServer } = serverFixture();

interface Running {
  venue: Venue;
  origin: string;
  logDir: string;
  get: () => Promise<BoxHealth>;
  free: () => Promise<Response>;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
  holder.supervisorDeps = undefined;
});

async function start(prepare: (venue: Venue) => Promise<void> = async () => {}): Promise<Running> {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  await prepare(venue);
  const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-box-health-"));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));
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
  const logDir = join(scratch, "logs");
  await mkdir(logDir);
  await writeFile(join(logDir, "waitron.log.3"), Buffer.alloc(1500, 1));
  await writeFile(join(logDir, "waitron.log.1"), Buffer.alloc(100, 1));
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  const env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_LOG_DIR: logDir,
    WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
    WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
  };
  const server: StartedServer = await startServer(env, env);
  cleanups.push(() => server.close());
  await awaitListening(port!);
  const origin = `http://127.0.0.1:${port}`;
  return {
    venue,
    origin,
    logDir,
    get: async () => {
      const response = await fetch(`${origin}/api/box/health`, {
        headers: { cookie: venue.managerCookie },
      });
      expect(response.status).toBe(200);
      return (await response.json()) as BoxHealth;
    },
    free: () =>
      fetch(`${origin}/api/box/free-space`, {
        method: "POST",
        headers: { cookie: venue.managerCookie },
      }),
  };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("the running server's Box status read and free-space deletion", () => {
  it("reads the box, frees its rotated logs, and shares one staging turn with its backups", async () => {
    const box = await start();

    const first = await box.get();
    expect(first.disk.reclaimable.bytes).toBeGreaterThanOrEqual(1500);
    expect(first.disk.reclaimable.backupRunning).toBe(false);
    expect(Array.isArray(first.printers)).toBe(true);
    // Every set but fiscal-none is enabled, payments included, so the readers table exists.
    expect(Array.isArray(first.readers)).toBe(true);
    expect(typeof first.filing).toBe("boolean");
    expect(first.canFree).toBe(true);
    expect(Array.isArray(first.notices)).toBe(true);
    expect(typeof first.disk.freeBytes).toBe("number");

    const freed = await box.free();
    expect(freed.status).toBe(200);
    expect(((await freed.json()) as { freedBytes: number }).freedBytes).toBeGreaterThanOrEqual(
      1500,
    );
    expect(await exists(join(box.logDir, "waitron.log.3"))).toBe(false);
    expect(await exists(join(box.logDir, "waitron.log.1"))).toBe(true);

    expect((await box.get()).disk.reclaimable.bytes).toBe(0);

    const turn = holder.supervisorDeps!.stagingTurn!;
    const during = await turn.runBackup(async () => box.get());
    expect(during.disk.reclaimable.backupRunning).toBe(true);
    expect((await box.get()).disk.reclaimable.backupRunning).toBe(false);
  });

  it("caches the clock check and the disk walk for a minute, and a deletion starts a fresh walk", async () => {
    const box = await start();
    vi.mocked(checkTimeHealth).mockClear();
    vi.mocked(readDiskUsage).mockClear();

    await box.get();
    await box.get();
    await box.get();
    expect(checkTimeHealth).toHaveBeenCalledTimes(1);
    expect(readDiskUsage).toHaveBeenCalledTimes(1);

    expect((await box.free()).status).toBe(200);
    await box.get();
    expect(readDiskUsage).toHaveBeenCalledTimes(2);
    expect(checkTimeHealth).toHaveBeenCalledTimes(1);
  });

  it.each(["mirror", "fenced"] as const)(
    "a %s node refuses the deletion as read-only and deletes nothing",
    async (mode) => {
      const box = await start(async (venue) => {
        await stampDeployment(suite.db, "preproduction");
        if (mode === "mirror") {
          await setDeploymentMode(suite.db, venue.cfg.nodeId, "mirror");
          await writeMirrorConfig(suite.db, venue.cfg.nodeId, {
            relayUrl: "https://127.0.0.1:1/",
            boxHostname: "box.test",
            boxCaPem: "unused",
            originNodeId: venue.cfg.nodeId,
          });
        } else {
          await writeNodeMembership(
            suite.db,
            signedMembershipDoc(1, {
              signerNodeId: venue.cfg.nodeId,
              nodes: [
                { nodeId: venue.cfg.nodeId, contactUrl: "https://box.test", standing: "sell-only" },
              ],
            }),
          );
        }
      });

      expect((await box.get()).canFree).toBe(false);
      const refused = await box.free();
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: { code: "node.read_only", params: {} } });
      expect(await exists(join(box.logDir, "waitron.log.3"))).toBe(true);
      expect(await exists(join(box.logDir, "waitron.log.1"))).toBe(true);
    },
  );
});
