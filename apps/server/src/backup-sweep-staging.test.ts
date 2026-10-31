import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { VENUE_FILE, WAL_SUFFIX } from "@waitron/store";
import { runOnce } from "./backup-sweep.js";
import { venueStagingEstimate } from "./backup-supervisor.js";
import {
  BACKUP_ENCRYPT_DIR_PREFIX,
  backupArchiveKey,
  parseBackupArchiveKey,
} from "./backup-keys.js";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import type { DeletableArchive } from "./backup-room.js";
import { SPACE_LOW_BYTES } from "./free-space-watch.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageBackend, StorageCall } from "./storage-backend.js";

const failWrites = vi.hoisted(() => ({ after: Infinity, writes: 0 }));
vi.mock("./artifact-file-io.js", async (original) => {
  const actual = await original<typeof import("./artifact-file-io.js")>();
  return {
    ...actual,
    writeAll: (...args: Parameters<typeof actual.writeAll>) => {
      failWrites.writes += 1;
      if (failWrites.writes > failWrites.after)
        return Promise.reject(Object.assign(new Error("no space"), { code: "ENOSPC" }));
      return actual.writeAll(...args);
    },
  };
});

const dirs: string[] = [];
afterEach(async () => {
  failWrites.after = Infinity;
  failWrites.writes = 0;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sweep-staging-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(stateDir, rel), `${rel}-contents`);
  return { root, stateDir, stagingDir: join(root, "staging") };
}

const stamp = new Date("2026-10-06T00:00:00Z");
const call: StorageCall = { signal: new AbortController().signal };
const DUMP = "D".repeat(1000);

function deps(f: Awaited<ReturnType<typeof fixture>>, backends: StorageBackend[]) {
  return {
    ...f,
    backends,
    db: {} as Database,
    modules: [],
    environment: "preproduction" as const,
    resolvers: {},
    recoveryKey: "key",
    retain: 3,
    retainDays: 30,
    destinationTimeoutMs: 60_000,
    signal: new AbortController().signal,
    log: vi.fn(),
    now: () => stamp,
    buildManifest: async () => ({
      manifestVersion: 1 as const,
      createdAt: stamp.toISOString(),
      environment: "preproduction" as const,
      modules: { core: 3 },
    }),
    archive: vi.fn(async (path: string) => writeFile(path, DUMP)),
  };
}

/** A filesystem reporting `free` bytes available, whatever the real disk holds. */
const freeSpace = (free: number) => vi.fn(async () => ({ bavail: free / 4, frsize: 4 }));

class Watched extends LocalFsBackend {
  puts = 0;
  override async putFile(key: string, path: string, c: StorageCall) {
    this.puts += 1;
    await super.putFile(key, path, c);
  }
}

/** A destination with no local folder, as a bucket has, storing into `dir` behind the scenes. */
class Bucket implements StorageBackend {
  puts = 0;
  readonly #inner: LocalFsBackend;
  constructor(
    readonly id: string,
    dir: string,
  ) {
    this.#inner = new LocalFsBackend(id, dir);
  }
  put: StorageBackend["put"] = (...a) => this.#inner.put(...a);
  putFile: StorageBackend["putFile"] = async (...a) => {
    this.puts += 1;
    await this.#inner.putFile(...a);
  };
  getFile: StorageBackend["getFile"] = (...a) => this.#inner.getFile(...a);
  get: StorageBackend["get"] = (...a) => this.#inner.get(...a);
  list: StorageBackend["list"] = (...a) => this.#inner.list(...a);
  delete: StorageBackend["delete"] = (...a) => this.#inner.delete(...a);
  deleteMany: StorageBackend["deleteMany"] = (...a) => this.#inner.deleteMany(...a);
  close() {}
}

it("a bucket-only run needs twice the database plus the floor", async () => {
  const f = await fixture();
  const backend = new Bucket("bucket", join(f.root, "bucket"));
  const d = deps(f, [backend]);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs: freeSpace(1999) }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 2000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
  expect(d.archive).not.toHaveBeenCalled();
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: freeSpace(2000 + START_FREE_SPACE_FLOOR),
  });
  expect(backend.puts).toBe(1);
});

it("two folders on the disk need two folder copies", async () => {
  const f = await fixture();
  const a = new Watched("a", join(f.root, "a"));
  const b = new Watched("b", join(f.root, "b"));
  const d = deps(f, [a, b]);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs: freeSpace(1999) }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 4000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
  expect(d.archive).not.toHaveBeenCalled();
  expect(a.puts + b.puts).toBe(0);
});

it("a folder on another disk adds nothing", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "b"));
  const other = await realpath(join(f.root, "b"));
  const deviceOf = vi.fn(async (path: string) => (path === other ? -1 : (await stat(path)).dev));
  const d = deps(f, [new Watched("a", join(f.root, "a")), new Watched("b", join(f.root, "b"))]);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs: freeSpace(1999), deviceOf }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
  expect(deviceOf).toHaveBeenCalledWith(other);
});

it("a folder and a link to it are two folder copies", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "a"));
  await symlink(join(f.root, "a"), join(f.root, "a-link"));
  const d = deps(f, [
    new Watched("a", join(f.root, "a")),
    new Watched("a-link", join(f.root, "a-link")),
  ]);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs: freeSpace(1999) }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 4000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
});

it("the floor is an option, its default START_FREE_SPACE_FLOOR", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  const d = deps(f, [backend]);
  await expect(
    runOnce({
      ...d,
      stagingEstimateBytes: async () => 1000,
      statfs: freeSpace(1999),
      spaceFloorBytes: 10,
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3010, availableBytes: 1999 },
  });
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: freeSpace(3012),
    spaceFloorBytes: 10,
  });
  expect(backend.puts).toBe(1);
  await expect(
    runOnce({
      ...d,
      stagingEstimateBytes: async () => 1000,
      statfs: freeSpace(3012),
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3000 + START_FREE_SPACE_FLOOR, availableBytes: 3012 },
  });
});

it("counts every local folder as on the disk, and goes on with the check, when the working folder's disk cannot be read", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "b"));
  const staging = join(f.root, "staging");
  const deviceOf = vi.fn(async (path: string) => {
    if (path === (await realpath(staging)))
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    return path === (await realpath(join(f.root, "b"))) ? -1 : (await stat(path)).dev;
  });
  const d = deps(f, [
    new Watched("a", join(f.root, "a")),
    new Watched("b", join(f.root, "b")),
    new Bucket("bucket", join(f.root, "bucket")),
  ]);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs: freeSpace(1999), deviceOf }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 4000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
  expect(d.log).toHaveBeenCalledWith("warn", "backup.staging_disk_unreadable", {
    errorCode: "unknown",
    errno: "EACCES",
  });
});

it("refuses before copying the database when free space is under three copies (the working copy, its encrypted file and the folder copy) plus the floor", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  const d = deps(f, [backend]);
  const statfs = freeSpace(1999);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3000 + START_FREE_SPACE_FLOOR, availableBytes: 1999 },
  });
  expect(statfs).toHaveBeenCalledWith(f.stagingDir);
  expect(d.archive).not.toHaveBeenCalled();
  expect(backend.puts).toBe(0);
  expect(await readdir(f.stagingDir).catch(() => [])).toEqual([]);
});

it("proceeds when free space covers three copies plus the floor", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  await runOnce({
    ...deps(f, [backend]),
    stagingEstimateBytes: async () => 1000,
    statfs: freeSpace(3000 + START_FREE_SPACE_FLOOR + 1000),
  });
  expect(backend.puts).toBe(1);
  expect(await readdir(f.stagingDir)).toEqual([]);
});

it("proceeds when free space is exactly three copies plus the floor", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  await runOnce({
    ...deps(f, [backend]),
    stagingEstimateBytes: async () => 1000,
    statfs: freeSpace(3000 + START_FREE_SPACE_FLOOR),
  });
  expect(backend.puts).toBe(1);
  await expect(
    runOnce({
      ...deps(f, [backend]),
      stagingEstimateBytes: async () => 1000,
      statfs: freeSpace(3000 + START_FREE_SPACE_FLOOR - 1),
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3000 + START_FREE_SPACE_FLOOR },
  });
  expect(backend.puts).toBe(1);
});

it("counts free blocks in the filesystem's fundamental block size, not its preferred transfer size", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  const d = deps(f, [backend]);
  // One free block: 4096 bytes, though one transfer-sized block would be a mebibyte.
  const statfs = vi.fn(async () => ({ bavail: 1, bsize: 1_048_576, frsize: 4096 }));
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 2049, statfs }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3 * 2049 + START_FREE_SPACE_FLOOR, availableBytes: 4096 },
  });
  expect(d.archive).not.toHaveBeenCalled();
});

it("proceeds when free space cannot be read", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  await runOnce({
    ...deps(f, [backend]),
    stagingEstimateBytes: async () => 1000,
    statfs: vi.fn(async () => {
      throw Object.assign(new Error("unsupported"), { code: "ENOSYS" });
    }),
  });
  expect(backend.puts).toBe(1);
});

it("refuses after the copy when free space is under the copy's actual size, and removes the copy", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  const d = deps(f, [backend]);
  // Enough for the estimate of a 10-byte database; then the copy turns out to be 1000 bytes.
  const statfs = vi
    .fn()
    .mockResolvedValueOnce({ bavail: 30 + START_FREE_SPACE_FLOOR, frsize: 1 })
    .mockResolvedValue({ bavail: 999, frsize: 1 });
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 10, statfs }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: DUMP.length, availableBytes: 999 },
  });
  expect(d.archive).toHaveBeenCalledOnce();
  expect(statfs).toHaveBeenCalledTimes(2);
  expect(backend.puts).toBe(0);
  expect(await readdir(f.stagingDir)).toEqual([]);
});

it("makes no check without a database size to estimate from", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  const statfs = freeSpace(0);
  await runOnce({ ...deps(f, [backend]), statfs });
  expect(statfs).not.toHaveBeenCalled();
  expect(backend.puts).toBe(1);
});

it("removes this run's partial files when encrypting runs out of space, leaving an earlier archive", async () => {
  const f = await fixture();
  const backend = new LocalFsBackend("a", join(f.root, "a"));
  await runOnce({ ...deps(f, [backend]), now: () => new Date("2026-10-05T00:00:00Z") });
  const earlier = await readdir(join(f.root, "a"));
  expect(earlier).toHaveLength(1);
  const before = await backend.get(earlier[0]!, call);
  // The header and its reserved tag are written; the first ciphertext chunk is not.
  failWrites.writes = 0;
  failWrites.after = 2;
  await expect(runOnce(deps(f, [backend]))).rejects.toMatchObject({ code: "ENOSPC" });
  expect(failWrites.writes).toBeGreaterThan(2);
  expect(await readdir(f.stagingDir)).toEqual([]);
  expect(await readdir(join(f.root, "a"))).toEqual(earlier);
  expect(parseBackupArchiveKey(earlier[0]!)?.timestamp.toISOString()).toBe(
    "2026-10-05T00:00:00.000Z",
  );
  expect(await backend.get(earlier[0]!, call)).toEqual(before);
});

it("estimates from the venue database file alone, not its write-ahead file, counting a missing one as empty", async () => {
  const venueDir = await mkdtemp(join(tmpdir(), "sweep-staging-venue-"));
  dirs.push(venueDir);
  expect(await venueStagingEstimate(venueDir)).toBe(0);
  await writeFile(join(venueDir, VENUE_FILE), Buffer.alloc(300));
  expect(await venueStagingEstimate(venueDir)).toBe(300);
  await writeFile(join(venueDir, `${VENUE_FILE}${WAL_SUFFIX}`), Buffer.alloc(50));
  await writeFile(join(venueDir, "node.db"), Buffer.alloc(7000));
  expect(await venueStagingEstimate(venueDir)).toBe(300);
});

const days = (n: number) => new Date(stamp.getTime() - n * 86_400_000);

/** Archives in a fresh folder `a`, each `bytes` long (sparse, so a large one costs no disk). */
async function seeded(f: Awaited<ReturnType<typeof fixture>>, archives: [Date, number][]) {
  const dir = join(f.root, "a");
  await mkdir(dir, { recursive: true });
  const keys: string[] = [];
  for (const [at, bytes] of archives) {
    const key = backupArchiveKey(at);
    await writeFile(join(dir, key), "");
    await truncate(join(dir, key), bytes);
    keys.push(key);
  }
  return { dir, keys, sizes: new Map(keys.map((k, i) => [join(dir, k), archives[i]![1]])) };
}

/** A filesystem reporting `base` bytes free plus the size of each listed file that is gone. */
function rising(base: number, sizes: Map<string, number>) {
  return vi.fn(async () => {
    let free = base;
    for (const [path, bytes] of sizes)
      if (
        !(await stat(path).then(
          () => true,
          () => false,
        ))
      )
        free += bytes;
    return { bavail: free, frsize: 1 };
  });
}

const left = async (dir: string) => (await readdir(dir)).sort();

it("deletes the oldest backup before copying when that makes the room, then stores and prunes as today", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = { ...deps(f, [backend]), retain: 2 };
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: rising(2800, s.sizes),
    spaceFloorBytes: 10,
    spaceAimBytes: 100,
    installationStartedAt: async () => days(10),
  });
  expect(d.log).toHaveBeenCalledWith("info", "backup.archive_deleted", {
    destination: "a",
    key: s.keys[0],
    bytes: 500,
    reason: "backup_room",
  });
  expect(backend.puts).toBe(1);
  const kept = await left(s.dir);
  expect(kept).toHaveLength(2);
  expect(kept).toContain(s.keys[2]);
  expect(kept).not.toContain(s.keys[0]);
  expect(kept).not.toContain(s.keys[1]);
});

it("after a +400-day step, deletes a correctly dated backup before one the step holds", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(401), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = { ...deps(f, [backend]), retain: 10 };
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: rising(2700, s.sizes),
    spaceFloorBytes: 10,
    spaceAimBytes: 100,
    installationStartedAt: async () => days(500),
    latestClockStep: async () => ({
      confirmedAt: days(3).toISOString(),
      stepMs: 400 * 86_400_000,
    }),
  });
  const deleted = d.log.mock.calls.filter(([, event]) => event === "backup.archive_deleted");
  expect(deleted.map(([, , fields]) => (fields as { key: string }).key)).toEqual([s.keys[1]]);
  expect(backend.puts).toBe(1);
  expect(await left(s.dir)).toContain(s.keys[0]);
});

it("deletes only what the floor needs when old backups cannot reach the aim, then stores", async () => {
  const f = await fixture();
  // The need is 3000 (two working copies and the folder copy). Free 2600 plus the two deletable
  // 500-byte backups falls short of the aim (4000) but reaches the floor (3010) after one.
  const s = await seeded(f, [
    [days(3), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = { ...deps(f, [backend]), retain: 10 };
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: rising(2600, s.sizes),
    spaceFloorBytes: 10,
    spaceAimBytes: 1000,
    installationStartedAt: async () => days(10),
  });
  const deleted = d.log.mock.calls.filter(([, event]) => event === "backup.archive_deleted");
  expect(deleted.map(([, , fields]) => (fields as { key: string }).key)).toEqual([s.keys[0]]);
  expect(backend.puts).toBe(1);
  const kept = await left(s.dir);
  expect(kept).toContain(s.keys[1]);
  expect(kept).toContain(s.keys[2]);
});

it("deletes no backup to make room while the clock step cannot be read, so a short run is refused", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = deps(f, [backend]);
  await expect(
    runOnce({
      ...d,
      stagingEstimateBytes: async () => 1000,
      statfs: rising(2700, s.sizes),
      spaceFloorBytes: 10,
      spaceAimBytes: 100,
      installationStartedAt: async () => days(10),
      latestClockStep: async () => {
        throw new Error("locked");
      },
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3010, availableBytes: 2700, afterDeleting: false },
  });
  expect(await left(s.dir)).toEqual([...s.keys].sort());
  expect(backend.puts).toBe(0);
});

it("refuses a run whose need even every deletable backup cannot meet, deleting nothing and copying nothing", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = deps(f, [backend]);
  const onArchivesDeleted = vi.fn(async () => {});
  await expect(
    runOnce({
      ...d,
      stagingEstimateBytes: async () => 1000,
      statfs: rising(2000, s.sizes),
      spaceFloorBytes: 10,
      spaceAimBytes: 100,
      installationStartedAt: async () => days(10),
      onArchivesDeleted,
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3010, availableBytes: 2000 },
  });
  expect(await left(s.dir)).toEqual([...s.keys].sort());
  expect(d.archive).not.toHaveBeenCalled();
  expect(backend.puts).toBe(0);
  expect(onArchivesDeleted).not.toHaveBeenCalled();
});

it("an archive from before the current installation is never deleted, so the run is refused", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(1), 500],
  ]);
  const d = deps(f, [new Watched("a", s.dir)]);
  await expect(
    runOnce({
      ...d,
      stagingEstimateBytes: async () => 1000,
      statfs: rising(2800, s.sizes),
      spaceFloorBytes: 10,
      spaceAimBytes: 100,
      installationStartedAt: async () => days(2),
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3010, availableBytes: 2800 },
  });
  expect(await left(s.dir)).toEqual([...s.keys].sort());
  expect(d.archive).not.toHaveBeenCalled();
});

it("without installationStartedAt the run deletes nothing", async () => {
  for (const installationStartedAt of [undefined, async () => null]) {
    const f = await fixture();
    const s = await seeded(f, [
      [days(3), 500],
      [days(2), 500],
      [days(1), 500],
    ]);
    const d = deps(f, [new Watched("a", s.dir)]);
    await expect(
      runOnce({
        ...d,
        stagingEstimateBytes: async () => 1000,
        statfs: rising(2800, s.sizes),
        spaceFloorBytes: 10,
        spaceAimBytes: 100,
        installationStartedAt,
      }),
    ).rejects.toMatchObject({ code: "backup.staging_space_low" });
    expect(await left(s.dir)).toEqual([...s.keys].sort());
  }
});

it("an installation start that cannot be read deletes nothing, is logged, and the room check still runs", async () => {
  const unreadable = vi.fn(async (): Promise<Date | null> => {
    throw Object.assign(new Error("busy"), { code: "EIO" });
  });
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = { ...deps(f, [backend]), retain: 5 };
  const options = {
    stagingEstimateBytes: async () => 1000,
    spaceFloorBytes: 10,
    spaceAimBytes: 100,
    installationStartedAt: unreadable,
  };
  // Over the floor but under the aim: a readable start would have deleted toward the aim.
  await runOnce({ ...d, ...options, statfs: rising(3050, s.sizes) });
  expect(backend.puts).toBe(1);
  expect(await left(s.dir)).toEqual(expect.arrayContaining(s.keys));
  expect(d.log).toHaveBeenCalledWith("warn", "backup.installation_start_unreadable", {
    errorCode: "unknown",
    errno: "EIO",
  });
  expect(d.log).not.toHaveBeenCalledWith("info", "backup.archive_deleted", expect.anything());
  await expect(runOnce({ ...d, ...options, statfs: rising(2800, s.sizes) })).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3010, availableBytes: 2800 },
  });
  expect(backend.puts).toBe(1);
  expect(await left(s.dir)).toEqual(expect.arrayContaining(s.keys));
  expect(unreadable).toHaveBeenCalledTimes(2);
});

it("the aim defaults to SPACE_LOW_BYTES", async () => {
  const f = await fixture();
  // Free space meets the floor exactly; the first deletion leaves the need plus SPACE_LOW_BYTES
  // short by one byte, the second reaches it, and the third is not needed.
  const s = await seeded(f, [
    [days(4), SPACE_LOW_BYTES - 11],
    [days(3), 100],
    [days(2), 100],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = { ...deps(f, [backend]), retain: 4 };
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: rising(3010, s.sizes),
    spaceFloorBytes: 10,
    installationStartedAt: async () => days(10),
  });
  const kept = await left(s.dir);
  expect(kept).not.toContain(s.keys[0]);
  expect(kept).not.toContain(s.keys[1]);
  expect(kept).toEqual(expect.arrayContaining([s.keys[2], s.keys[3]]));
  expect(backend.puts).toBe(1);
});

it("calls onArchivesDeleted once with what the first check deleted and the time of the report", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 200],
    [days(2), 200],
    [days(1), 500],
  ]);
  const onArchivesDeleted = vi.fn<
    (deleted: readonly DeletableArchive[], at: Date) => Promise<void>
  >(async () => {});
  await runOnce({
    ...deps(f, [new Watched("a", s.dir)]),
    stagingEstimateBytes: async () => 1000,
    statfs: rising(2800, s.sizes),
    spaceFloorBytes: 10,
    spaceAimBytes: 100,
    installationStartedAt: async () => days(10),
    onArchivesDeleted,
  });
  expect(onArchivesDeleted).toHaveBeenCalledOnce();
  const [deleted, at] = onArchivesDeleted.mock.calls[0]!;
  expect(deleted.map((a) => a.key)).toEqual([s.keys[0], s.keys[1]]);
  expect(deleted[0]).toMatchObject({ destination: "a", bytes: 200 });
  expect(at).toEqual(stamp);
});

it("refused after deleting still raises the alert", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const outcomes: BackupOutcomeHolder = { failed: new Map() };
  const stoppedWhenReported: unknown[] = [];
  const onArchivesDeleted = vi.fn(async () => {
    stoppedWhenReported.push(outcomes.runStopped);
  });
  const d = deps(f, [new Watched("a", s.dir)]);
  // Deleting frees nothing here (a hard link, say), so the sum's promise is not kept.
  await expect(
    runOnce({
      ...d,
      outcomes,
      stagingEstimateBytes: async () => 1000,
      statfs: freeSpace(2800),
      spaceFloorBytes: 10,
      spaceAimBytes: 100,
      installationStartedAt: async () => days(10),
      onArchivesDeleted,
    }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 3010, availableBytes: 2800 },
  });
  expect(onArchivesDeleted).toHaveBeenCalledOnce();
  expect(stoppedWhenReported).toEqual([undefined]);
  expect(outcomes.runStopped).toMatchObject({ code: "backup.staging_space_low" });
  expect(d.archive).not.toHaveBeenCalled();
});

it("a failing onArchivesDeleted is logged with its code and the run goes on", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(2), 500],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = deps(f, [backend]);
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 1000,
    statfs: rising(2800, s.sizes),
    spaceFloorBytes: 10,
    spaceAimBytes: 100,
    installationStartedAt: async () => days(10),
    onArchivesDeleted: async () => {
      throw Object.assign(new Error("locked"), { code: "EBUSY" });
    },
  });
  expect(d.log).toHaveBeenCalledWith("warn", "backup.archives_deleted_alert_failed", {
    errorCode: "unknown",
    errno: "EBUSY",
  });
  expect(backend.puts).toBe(1);
});

/** Answers `before` in turn, then `last` of the encrypted file's real size, read from the working
 * folder at that moment. */
function thenEncrypted(
  f: Awaited<ReturnType<typeof fixture>>,
  before: number[],
  last: (encrypted: number) => number,
) {
  const seen = { encrypted: 0 };
  let calls = 0;
  const statfs = vi.fn(async () => {
    calls += 1;
    if (calls <= before.length) return { bavail: before[calls - 1]!, frsize: 1 };
    const dir = (await readdir(f.stagingDir)).find((n) => n.startsWith(BACKUP_ENCRYPT_DIR_PREFIX));
    seen.encrypted = (await stat(join(f.stagingDir, dir!, "artifact"))).size;
    return { bavail: last(seen.encrypted), frsize: 1 };
  });
  return { statfs, seen };
}

it("a copy larger than the estimate is refused before any destination when no backup can be deleted", async () => {
  const f = await fixture();
  const folder = new Watched("a", join(f.root, "a"));
  const bucket = new Bucket("bucket", join(f.root, "bucket"));
  const outcomes: BackupOutcomeHolder = { failed: new Map() };
  // Enough for the estimate of a 10-byte database and for the 1000-byte copy, one byte short of
  // its encrypted file plus the floor.
  const { statfs, seen } = thenEncrypted(f, [30 + 10, DUMP.length], (encrypted) => encrypted + 9);
  const err = await runOnce({
    ...deps(f, [folder, bucket]),
    outcomes,
    stagingEstimateBytes: async () => 10,
    statfs,
    spaceFloorBytes: 10,
    spaceAimBytes: 0,
  }).catch((e: unknown) => e);
  expect(seen.encrypted).toBeGreaterThan(DUMP.length);
  expect(err).toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: seen.encrypted + 10, availableBytes: seen.encrypted + 9 },
  });
  expect(outcomes.runStopped).toEqual({
    code: "backup.staging_space_low",
    at: stamp.toISOString(),
    since: stamp.toISOString(),
    sizes: { neededBytes: seen.encrypted + 10, availableBytes: seen.encrypted + 9 },
  });
  expect(folder.puts + bucket.puts).toBe(0);
  expect(statfs).toHaveBeenCalledTimes(3);
  expect(await readdir(f.stagingDir)).toEqual([]);
});

it("a copy larger than the estimate deletes the oldest backup at the second check, then stores", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 1_000_000],
    [days(1), 500],
  ]);
  const backend = new Watched("a", s.dir);
  const d = deps(f, [backend]);
  const onArchivesDeleted = vi.fn<
    (deleted: readonly DeletableArchive[], at: Date) => Promise<void>
  >(async () => {});
  // The first check (10-byte estimate) and the after-copy check (1000 bytes) pass without deleting;
  // the encrypted file is larger than the copy.
  await runOnce({
    ...d,
    stagingEstimateBytes: async () => 10,
    statfs: rising(DUMP.length, s.sizes),
    spaceFloorBytes: 10,
    spaceAimBytes: 100,
    installationStartedAt: async () => days(10),
    onArchivesDeleted,
  });
  expect(d.log).toHaveBeenCalledWith("info", "backup.archive_deleted", {
    destination: "a",
    key: s.keys[0],
    bytes: 1_000_000,
    reason: "backup_room",
  });
  expect(onArchivesDeleted).toHaveBeenCalledOnce();
  expect(onArchivesDeleted.mock.calls[0]![0].map((a) => a.key)).toEqual([s.keys[0]]);
  expect(onArchivesDeleted.mock.calls[0]![1]).toEqual(stamp);
  expect(backend.puts).toBe(1);
  const kept = await left(s.dir);
  expect(kept).toHaveLength(2);
  expect(kept).toContain(s.keys[1]);
  expect(kept).not.toContain(s.keys[0]);
});

it("the second check counts the encrypted file's real size once per local destination on the disk", async () => {
  for (const linked of [false, true]) {
    const f = await fixture();
    await mkdir(join(f.root, "a"));
    const second = join(f.root, linked ? "a-link" : "b");
    if (linked) await symlink(join(f.root, "a"), second);
    const a = new Watched("a", join(f.root, "a"));
    const b = new Watched("b", second);
    const { statfs, seen } = thenEncrypted(f, [10_000, 10_000], (encrypted) => 2 * encrypted + 9);
    const err = await runOnce({
      ...deps(f, [a, b]),
      stagingEstimateBytes: async () => 10,
      statfs,
      spaceFloorBytes: 10,
      spaceAimBytes: 0,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "backup.staging_space_low",
      params: { neededBytes: 2 * seen.encrypted + 10, availableBytes: 2 * seen.encrypted + 9 },
    });
    expect(a.puts + b.puts).toBe(0);
  }
});

it("the second check counts every local folder, reading the disk once, when the working folder's disk cannot be read", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "b"));
  const staging = join(f.root, "staging");
  const deviceOf = vi.fn(async (path: string) => {
    if (path === (await realpath(staging)))
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    return path === (await realpath(join(f.root, "b"))) ? -1 : (await stat(path)).dev;
  });
  const a = new Watched("a", join(f.root, "a"));
  const b = new Watched("b", join(f.root, "b"));
  const d = deps(f, [a, b]);
  const { statfs, seen } = thenEncrypted(f, [10_000, 10_000], (encrypted) => 2 * encrypted + 9);
  const err = await runOnce({
    ...d,
    stagingEstimateBytes: async () => 10,
    statfs,
    deviceOf,
    spaceFloorBytes: 10,
    spaceAimBytes: 0,
  }).catch((e: unknown) => e);
  expect(err).toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 2 * seen.encrypted + 10 },
  });
  expect(a.puts + b.puts).toBe(0);
  expect(
    d.log.mock.calls.filter(([, event]) => event === "backup.staging_disk_unreadable"),
  ).toHaveLength(1);
});

it("a bucket-only run makes no second check", async () => {
  const f = await fixture();
  const bucket = new Bucket("bucket", join(f.root, "bucket"));
  const statfs = freeSpace(10_000_000);
  const room = { stagingEstimateBytes: async () => 10, spaceFloorBytes: 10, spaceAimBytes: 0 };
  await runOnce({ ...deps(f, [bucket]), ...room, statfs });
  expect(bucket.puts).toBe(1);
  expect(statfs).toHaveBeenCalledTimes(2);
  // Control: a folder beside it adds the second check.
  const g = await fixture();
  const folder = new Watched("a", join(g.root, "a"));
  const withFolder = freeSpace(10_000_000);
  await runOnce({
    ...deps(g, [folder, new Bucket("bucket", join(g.root, "bucket"))]),
    ...room,
    statfs: withFolder,
  });
  expect(folder.puts).toBe(1);
  expect(withFolder).toHaveBeenCalledTimes(3);
});

it("reports a deletion at the second check with the clock's time then, not the run's start", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 10_000],
    [days(1), 10_000],
  ]);
  let clock = new Date("2026-10-28T23:59:59.000Z");
  const d = deps(f, [new Watched("a", s.dir)]);
  const deleted = () => d.log.mock.calls.some(([, event]) => event === "backup.archive_deleted");
  // Room for the first check and the after-copy check; at the second, one byte short until the
  // oldest archive is gone.
  const { statfs } = thenEncrypted(f, [1e9, 1e9], (encrypted) =>
    deleted() ? encrypted + 10_000 : encrypted - 1,
  );
  const reported: Date[] = [];
  await runOnce({
    ...d,
    now: () => clock,
    archive: vi.fn(async (path: string) => {
      await writeFile(path, DUMP);
      clock = new Date("2026-10-29T00:00:01.000Z");
    }),
    stagingEstimateBytes: async () => 10,
    spaceFloorBytes: 10,
    spaceAimBytes: 10,
    statfs,
    installationStartedAt: async () => days(10),
    onArchivesDeleted: async (_, at) => {
      reported.push(at);
    },
  });
  expect(await left(s.dir)).not.toContain(s.keys[0]);
  expect(reported.map((at) => at.toISOString())).toEqual(["2026-10-29T00:00:01.000Z"]);
});

it("a run with room to spare never reads the installation start", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 500],
    [days(1), 500],
  ]);
  const installationStartedAt = vi.fn(async () => days(10));
  const backend = new Watched("a", s.dir);
  await runOnce({
    ...deps(f, [backend]),
    stagingEstimateBytes: async () => 10,
    spaceFloorBytes: 10,
    spaceAimBytes: 10,
    statfs: freeSpace(10_000_000),
    installationStartedAt,
  });
  expect(backend.puts).toBe(1);
  expect(installationStartedAt).not.toHaveBeenCalled();
});

it("a run that deletes at both of its checks reads the installation start once", async () => {
  const f = await fixture();
  const s = await seeded(f, [
    [days(3), 10_000],
    [days(2), 10_000],
    [days(1), 10_000],
  ]);
  const gone = (i: number) =>
    stat(join(s.dir, s.keys[i]!)).then(
      () => false,
      () => true,
    );
  // The first check is short until the oldest archive goes; the second, until the next one does.
  const statfs = vi.fn(async () => {
    const dir = (await readdir(f.stagingDir)).find((n) => n.startsWith(BACKUP_ENCRYPT_DIR_PREFIX));
    if (dir === undefined) return { bavail: 39 + ((await gone(0)) ? 10_000 : 0), frsize: 1 };
    const encrypted = (await stat(join(f.stagingDir, dir, "artifact"))).size;
    return { bavail: encrypted + 9 + ((await gone(1)) ? 10_000 : 0), frsize: 1 };
  });
  const installationStartedAt = vi.fn(async () => days(10));
  const onArchivesDeleted = vi.fn(async () => {});
  const backend = new Watched("a", s.dir);
  await runOnce({
    ...deps(f, [backend]),
    stagingEstimateBytes: async () => 10,
    spaceFloorBytes: 10,
    spaceAimBytes: 10,
    statfs,
    installationStartedAt,
    onArchivesDeleted,
  });
  expect(backend.puts).toBe(1);
  expect(onArchivesDeleted).toHaveBeenCalledTimes(2);
  expect(await left(s.dir)).not.toContain(s.keys[0]);
  expect(await left(s.dir)).not.toContain(s.keys[1]);
  expect(installationStartedAt).toHaveBeenCalledOnce();
});
