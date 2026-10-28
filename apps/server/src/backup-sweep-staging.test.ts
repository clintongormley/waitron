import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { VENUE_FILE, WAL_SUFFIX } from "@waitron/store";
import { runOnce } from "./backup-sweep.js";
import { venueStagingEstimate } from "./backup-supervisor.js";
import { parseBackupArchiveKey } from "./backup-keys.js";
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
