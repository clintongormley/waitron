// Needs a filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_FROM_SPARE names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem"). Its own filesystem: two files filling one
// at once can fail each other.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import type { Alert } from "@waitron/module";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SPARE_SPACE_FILE, SPARE_SPACE_RELEASED_FILE } from "@waitron/provisioning";
import { mintRecoveryKey } from "./backup-config.js";
import { backupArchiveKey } from "./backup-keys.js";
import { writeBackupRoomNote } from "./backup-room-note.js";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import type { StartServerSeams } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { mintedBoxLeaf } from "./box-secrets.js";
import { runEntry, type RecoveryServeOptions } from "./node-entry.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { SPARE_SPACE_BYTES } from "./spare-space.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

const KiB = 1024;
const MiB = 1024 * KiB;
const ORIGIN = "https://dashboard.example.com";
let insecure: Agent | undefined;
let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;
let migrationsRoot: string | undefined;

beforeAll(async () => {
  insecure = new Agent({ connect: { rejectUnauthorized: false } });
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_FROM_SPARE");
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK) console.warn(`start-from-spare tests SKIPPED: ${opened.reason}`);
  migrationsRoot = await mkdtemp(join(tmpdir(), "wt-start-from-spare-migrations-"));
  await copyMigrationsRoot(migrationsRoot);
}, 60_000);
afterAll(async () => {
  disk?.unfill();
  disk?.close();
  if (insecure !== undefined) await insecure.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
});

function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

interface Box {
  stateDir: string;
  baseEnv: NodeJS.ProcessEnv;
}

/** A seeded venue in a fresh folder on the small disk, removed when the case finishes. */
async function placeBox(small: SmallDisk, name: string): Promise<Box> {
  const stateDir = realpathSync(small.folder(name));
  onTestFinished(() => {
    small.unfill();
    rmSync(stateDir, { recursive: true, force: true });
  });
  const venueDir = join(stateDir, "venue");
  mkdirSync(venueDir);
  mkdirSync(join(stateDir, "logs"));
  writeFileSync(
    join(stateDir, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(venueDir);
  const venue = await setupVenue(store.venue);
  await store.close();
  await writeRecoveryState(stateDir, FRESH);
  const [port] = await freePorts(1);
  return {
    stateDir,
    baseEnv: {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
      WAITRON_MANAGEMENT_ORIGIN: ORIGIN,
      WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
      WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot!,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    },
  };
}

/** One container start through `runEntry` with a real `startServer`; the server it starts is closed
 *  when the case finishes, or by `close()`. */
async function start(box: Box, spareBytes: number, seams: StartServerSeams = {}) {
  let server: { close(): Promise<void> } | undefined;
  const log = vi.fn();
  const serveRecovery = vi.fn<(app: unknown, opts: RecoveryServeOptions) => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  await runEntry({
    args: [],
    baseEnv: box.baseEnv,
    stateDir: box.stateDir,
    venueDir: join(box.stateDir, "venue"),
    loadBoxEnv,
    readRecoveryState,
    writeRecoveryState,
    startServer: (env, base) => startServer(env, base, { spareBytes, ...seams }),
    serveRecovery,
    installShutdownHandlers: (started) => {
      server = started;
    },
    scheduleStayedUp: () => {},
    log,
    exit: vi.fn(),
    migrationsRoot: migrationsRoot!,
    freeSpaceFloor: 8 * MiB,
    spareBytes,
  });
  const close = async () => {
    const running = server;
    server = undefined;
    await running?.close();
  };
  onTestFinished(close);
  const events = () => log.mock.calls.map(([, event]) => event as string);
  const logged = (event: string) =>
    log.mock.calls
      .filter(([, each]) => each === event)
      .map(([, , params]) => params as Record<string, unknown>);
  return { up: () => server !== undefined, serveRecovery, events, logged, close };
}

const url = (box: Box, path: string) =>
  `${mintedBoxLeaf(box.stateDir) ? "https" : "http"}://127.0.0.1:${httpPort()}${path}`;

/** A till write with no credentials: the full-disk gate answers it before the route signs anyone
 *  in, so a 507 shows the stop holds and the route's own 401 shows the request passed the gate. */
async function probe(box: Box): Promise<{ status: number; code?: unknown }> {
  const response = await fetch(url(box, "/api/working-orders"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    dispatcher: insecure!,
  } as RequestInit);
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } };
  return { status: response.status, code: body.error?.code };
}

async function boxAlerts(box: Box): Promise<Alert[]> {
  const login = await fetch(url(box, "/management-api/session"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: "owner@example.test", password: "dashPass123" }),
    dispatcher: insecure!,
  } as RequestInit);
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const response = await fetch(url(box, "/management-api/alerts"), {
    headers: { cookie },
    dispatcher: insecure!,
  } as RequestInit);
  expect(response.status).toBe(200);
  return ((await response.json()) as { alerts: Alert[] }).alerts.filter(
    (alert) => alert.area === "box",
  );
}

const spareIn = (box: Box) => join(box.stateDir, SPARE_SPACE_FILE);
const markerIn = (box: Box) => join(box.stateDir, SPARE_SPACE_RELEASED_FILE);

describe("a box started from its spare file", () => {
  it("a full disk with nothing to delete but the spare boots a real server, and the tills are stopped", async (ctx) => {
    const small = needDisk(ctx);
    const box = await placeBox(small, "boots");
    await (await start(box, SPARE_SPACE_BYTES)).close();
    expect(statSync(spareIn(box)).size).toBe(SPARE_SPACE_BYTES);
    small.fill();

    const started = await start(box, SPARE_SPACE_BYTES);
    expect(started.up()).toBe(true);
    expect(started.serveRecovery).not.toHaveBeenCalled();
    expect(existsSync(spareIn(box))).toBe(false);
    expect(statSync(markerIn(box)).isFile()).toBe(true);
    expect(await probe(box)).toEqual({ status: 507, code: "storage.disk_full" });
    expect((await boxAlerts(box)).map(({ key }) => key)).toContain("storage.disk_full");
  });

  it("…without a spare, the same disk serves the full-disk page", async (ctx) => {
    const small = needDisk(ctx);
    const box = await placeBox(small, "no-spare");
    await (await start(box, 0)).close();
    small.fill();

    const started = await start(box, 0);
    expect(started.up()).toBe(false);
    expect(started.serveRecovery).toHaveBeenCalledOnce();
    expect(started.events()).toContain("recovery.serving_disk_full");
  });

  it("after a release, the tills stay stopped across a restart with 21.5 MiB free", async (ctx) => {
    const small = needDisk(ctx);
    const box = await placeBox(small, "restart");
    await (await start(box, 6 * MiB)).close();
    small.fill(2 * MiB);
    const released = await start(box, 6 * MiB);
    expect(released.up()).toBe(true);
    expect(await probe(box)).toEqual({ status: 507, code: "storage.disk_full" });
    await released.close();
    small.unfill();

    small.fill(21.5 * MiB);
    expect(small.free()).toBeGreaterThan(21 * MiB);
    expect(small.free()).toBeLessThan(FULL_DISK_BYTES + 6 * MiB);
    const restarted = await start(box, 6 * MiB);
    expect(restarted.up()).toBe(true);
    expect(existsSync(spareIn(box))).toBe(false);
    expect(statSync(markerIn(box)).isFile()).toBe(true);
    // Room enough that free space alone would not stop the tills; only the marker can.
    expect(small.free()).toBeGreaterThanOrEqual(FULL_DISK_BYTES + 512 * KiB);
    expect(await probe(box)).toEqual({ status: 507, code: "storage.disk_full" });
  });

  it("a start that released nothing, with about 21 MiB free, does not stop the tills", async (ctx) => {
    const small = needDisk(ctx);
    const box = await placeBox(small, "no-release");
    await (await start(box, 6 * MiB)).close();
    expect(statSync(spareIn(box)).size).toBe(6 * MiB);
    // On the macOS image one venue and the spare leave about 21.2 MiB, so this fill may write nothing.
    small.fill(21.5 * MiB);
    expect(small.free()).toBeGreaterThan(21 * MiB);
    expect(small.free()).toBeLessThan(FULL_DISK_BYTES + 6 * MiB);

    const started = await start(box, 6 * MiB);
    expect(started.up()).toBe(true);
    expect(small.free()).toBeGreaterThanOrEqual(FULL_DISK_BYTES + 512 * KiB);
    expect(await probe(box)).toEqual({ status: 401, code: "session.required" });
  });

  it("the running box writes the spare back once there is room, deletes the marker, and the tills can save again", async (ctx) => {
    const small = needDisk(ctx);
    const box = await placeBox(small, "write-back");
    await (await start(box, 6 * MiB)).close();
    small.fill(2 * MiB);
    const started = await start(box, 6 * MiB, { freeSpaceWatch: { intervalMs: 200 } });
    expect(await probe(box)).toEqual({ status: 507, code: "storage.disk_full" });

    small.unfill();
    await vi.waitFor(
      () => {
        expect(statSync(spareIn(box)).size).toBe(6 * MiB);
        expect(existsSync(markerIn(box))).toBe(false);
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(await probe(box)).toEqual({ status: 401, code: "session.required" });
    await started.close();
  });

  /**
   * A dashboard-managed box (its recovery key only in backup.env, no sealed settings, so the booted
   * server runs no backups) with a backup folder on the full disk: the oldest archive is 17 MiB, the
   * next 2 MiB, the newest 256 KiB and never deletable. Filled to leave 6 MiB (under
   * SPARE_SPACE_BYTES, so a start that deletes nothing releases the spare, and enough to boot with
   * the 1 MiB spare released), the start deletes toward the floor, the 1 MiB spare plus
   * FULL_DISK_BYTES = 17 MiB: the oldest alone brings free space to about 23 MiB, so it is the one
   * deletion, and the spare stays.
   */
  async function boxWithBackups(small: SmallDisk, name: string) {
    const box = await placeBox(small, name);
    await (await start(box, MiB)).close();
    expect(statSync(spareIn(box)).size).toBe(MiB);
    const folder = realpathSync(small.folder(`${name}-backups`));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    writeFileSync(
      join(box.stateDir, "backup.env"),
      `WAITRON_BACKUP_RECOVERY_KEY=${mintRecoveryKey()}\n`,
    );
    const now = Date.now();
    const daysAgo = (n: number) => new Date(now - n * 86_400_000);
    await writeBackupRoomNote({
      stateDir: box.stateDir,
      venueDir: join(box.stateDir, "venue"),
      nodeId: box.baseEnv.WAITRON_TILL_NODE_ID!,
      installationStartedAt: daysAgo(3),
      managedByEnvironment: false,
      folders: [{ destination: "usb", dir: folder }],
      now: () => new Date(now),
      log: () => undefined,
    });
    const archive = (at: Date, bytes: number) => {
      const key = backupArchiveKey(at);
      writeFileSync(join(folder, key), Buffer.alloc(bytes, 7));
      return key;
    };
    const oldest = archive(daysAgo(2), 17 * MiB);
    archive(daysAgo(1), 2 * MiB);
    archive(daysAgo(0), 256 * KiB);
    return { box, oldest };
  }

  it("a full disk with old backups: the start deletes them before it gives up its spare", async (ctx) => {
    const small = needDisk(ctx);
    const { box, oldest } = await boxWithBackups(small, "start-room");
    small.fill(6 * MiB);
    expect(small.free()).toBeLessThan(SPARE_SPACE_BYTES);

    const started = await start(box, MiB);
    expect(
      started.logged("backup.archive_deleted").filter(({ reason }) => reason === "start_room"),
    ).toEqual([{ destination: "usb", key: oldest, bytes: 17 * MiB, reason: "start_room" }]);
    expect(statSync(spareIn(box)).size).toBe(MiB);
    expect(existsSync(markerIn(box))).toBe(false);
  });

  it("…but once venue.db has been replaced since the note, it deletes none and gives up the spare", async (ctx) => {
    const small = needDisk(ctx);
    const { box } = await boxWithBackups(small, "start-room-replaced");
    const venueDb = join(box.stateDir, "venue", "venue.db");
    copyFileSync(venueDb, `${venueDb}.replacement`);
    renameSync(`${venueDb}.replacement`, venueDb);
    small.fill(6 * MiB);
    expect(small.free()).toBeLessThan(SPARE_SPACE_BYTES);

    const started = await start(box, MiB);
    expect(started.logged("backup.start_room_skipped")).toEqual([{ reason: "identity_mismatch" }]);
    expect(
      started.logged("backup.archive_deleted").filter(({ reason }) => reason === "start_room"),
    ).toEqual([]);
    expect(existsSync(spareIn(box))).toBe(false);
    expect(statSync(markerIn(box)).isFile()).toBe(true);
  });
});
