// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_BACKUP_ROOM names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { STUB_NODE } from "./testing/node-copy.js";
import { backupArchiveKey } from "./backup-keys.js";
import { runOnce } from "./backup-sweep.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageCall } from "./storage-backend.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";

const MiB = 1024 * 1024;
const D = 6 * MiB;
const FLOOR = 1 * MiB;
const AIM = 4 * MiB;
const NOW = new Date("2026-10-28T12:00:00Z");
const INSTALLED = new Date("2026-10-25T12:00:00Z");
const OLDER = backupArchiveKey(new Date("2026-10-26T12:00:00Z"));
const NEWEST = backupArchiveKey(new Date("2026-10-27T12:00:00Z"));

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_BACKUP_ROOM");
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK)
    console.warn(`backup-room full-disk tests SKIPPED: ${opened.reason}`);
});
afterEach(() => disk?.unfill());
afterAll(() => disk?.close());

/** The small disk, or the case is skipped (or fails where the disk is required). */
function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

interface Case {
  /** Archives already in the backup folder, by key, with their sizes. */
  existing: readonly (readonly [string, number])[];
  /** Bytes left free once the disk is filled. */
  leave: number;
  estimate: number;
}

async function runCase(small: SmallDisk, name: string, c: Case) {
  const root = small.folder(name);
  try {
    const stateDir = join(root, "state");
    await mkdir(join(stateDir, "tls"), { recursive: true });
    for (const rel of RECOVERY_FILES) await writeFile(join(stateDir, rel), `${rel}-x`);
    const stagingDir = join(stateDir, "backup-staging");
    const backupDir = join(root, "backups");
    await mkdir(backupDir);
    for (const [key, size] of c.existing) await writeFile(join(backupDir, key), randomBytes(size));
    const payload = randomBytes(D);
    small.fill(c.leave);
    const freeAtStart = small.free();
    let puts = 0;
    class Counting extends LocalFsBackend {
      override async putFile(key: string, path: string, call: StorageCall) {
        puts += 1;
        await super.putFile(key, path, call);
      }
    }
    const log = vi.fn();
    const archive = vi.fn(async (out: string) => writeFile(out, payload));
    let thrown: unknown = null;
    try {
      await runOnce({
        backends: [new Counting("box", backupDir)],
        db: {} as Database,
        node: STUB_NODE,
        modules: [],
        environment: "preproduction",
        resolvers: {},
        stateDir,
        stagingDir,
        recoveryKey: "a-recovery-key-long-enough",
        retain: 7,
        retainDays: 30,
        destinationTimeoutMs: 60_000,
        signal: new AbortController().signal,
        log,
        now: () => NOW,
        buildManifest: async () => ({
          manifestVersion: 1 as const,
          createdAt: NOW.toISOString(),
          environment: "preproduction" as const,
          modules: { core: 3 },
        }),
        archive,
        stagingEstimateBytes: async () => c.estimate,
        spaceFloorBytes: FLOOR,
        spaceAimBytes: AIM,
        installationStartedAt: async () => INSTALLED,
      });
    } catch (err) {
      thrown = err;
    }
    return {
      freeAtStart,
      thrown,
      puts,
      archive,
      log,
      stored: (await readdir(backupDir)).sort(),
      staging: await readdir(stagingDir),
    };
  } finally {
    small.unfill();
    await rm(root, { recursive: true, force: true });
  }
}

const logged = (log: ReturnType<typeof vi.fn>, code: string) =>
  log.mock.calls.filter((call) => call[1] === code);

it("with room for between two and three copies, deletes the oldest backup and stores", async (ctx) => {
  const small = needDisk(ctx);
  const r = await runCase(small, "between", {
    existing: [
      [OLDER, D],
      [NEWEST, D],
    ],
    leave: 15 * MiB,
    estimate: D,
  });
  console.log(
    JSON.stringify({
      case: "between",
      freeAtStart: r.freeAtStart,
      stored: r.stored,
      failed: logged(r.log, "backup.destination_failed"),
    }),
  );
  // Short of three copies plus the floor, but deleting the older archive reaches it.
  expect(r.freeAtStart).toBeLessThan(3 * D + FLOOR);
  expect(r.freeAtStart + D).toBeGreaterThanOrEqual(3 * D + FLOOR);
  expect(r.thrown).toBeNull();
  expect(r.stored).not.toContain(OLDER);
  expect(r.stored).toContain(NEWEST);
  expect(r.stored).toHaveLength(2);
  expect(logged(r.log, "backup.destination_failed")).toEqual([]);
  expect(logged(r.log, "backup.archive_deleted")).toEqual([
    [
      "info",
      "backup.archive_deleted",
      { destination: "box", key: OLDER, bytes: D, reason: "backup_room" },
    ],
  ]);
}, 120_000);

it("a run whose need even every deletable backup cannot meet deletes nothing and is refused before copying", async (ctx) => {
  const small = needDisk(ctx);
  const r = await runCase(small, "unreachable", {
    existing: [
      [OLDER, 1 * MiB],
      [NEWEST, D],
    ],
    leave: 10 * MiB,
    estimate: D,
  });
  console.log(JSON.stringify({ case: "unreachable", freeAtStart: r.freeAtStart }));
  expect(r.freeAtStart + 1 * MiB).toBeLessThan(3 * D + FLOOR);
  expect(r.thrown).toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3 * D + FLOOR, availableBytes: r.freeAtStart },
  });
  expect(r.archive).not.toHaveBeenCalled();
  expect(r.puts).toBe(0);
  expect(r.stored).toEqual([OLDER, NEWEST].sort());
  expect(logged(r.log, "backup.archive_deleted")).toEqual([]);
}, 120_000);

it("a copy larger than the estimate is caught before the folder copy", async (ctx) => {
  const small = needDisk(ctx);
  const r = await runCase(small, "larger", {
    existing: [[NEWEST, D]],
    leave: 16 * MiB,
    estimate: D / 3,
  });
  console.log(JSON.stringify({ case: "larger", freeAtStart: r.freeAtStart }));
  // The first check (three estimates plus the floor) and the after-copy check (the copy) pass; the
  // encrypted copy (D and its header) plus the floor does not fit beside the staged copy.
  expect(r.freeAtStart).toBeGreaterThanOrEqual(3 * (D / 3) + FLOOR);
  expect(r.freeAtStart - D).toBeGreaterThanOrEqual(D);
  expect(r.freeAtStart - 2 * D).toBeLessThan(D + FLOOR);
  expect(r.archive).toHaveBeenCalledTimes(1);
  expect(r.thrown).toMatchObject({ code: "backup.staging_space_low" });
  // Only the check after encryption needs the encrypted copy plus the floor: just over D + FLOOR.
  const { neededBytes } = (r.thrown as { params: { neededBytes: number } }).params;
  expect(neededBytes).toBeGreaterThan(D + FLOOR);
  expect(neededBytes).toBeLessThan(D + FLOOR + MiB);
  expect(r.puts).toBe(0);
  expect(r.stored).toEqual([NEWEST]);
  expect(JSON.stringify(r.log.mock.calls)).not.toContain("ENOSPC");
  expect(r.staging).toEqual([]);
}, 120_000);
