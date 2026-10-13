import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { VENUE_FILE, WAL_SUFFIX } from "@waitron/store";
import { runOnce } from "./backup-sweep.js";
import { venueStagingEstimate } from "./backup-supervisor.js";
import { parseBackupArchiveKey } from "./backup-keys.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageCall } from "./storage-backend.js";

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

function deps(f: Awaited<ReturnType<typeof fixture>>, backends: LocalFsBackend[]) {
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
const freeSpace = (free: number) => vi.fn(async () => ({ bavail: free / 4, bsize: 4 }));

class Watched extends LocalFsBackend {
  puts = 0;
  override async putFile(key: string, path: string, c: StorageCall) {
    this.puts += 1;
    await super.putFile(key, path, c);
  }
}

it("refuses before copying the database when free space is under twice the database's size", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  const d = deps(f, [backend]);
  const statfs = freeSpace(1999);
  await expect(
    runOnce({ ...d, stagingEstimateBytes: async () => 1000, statfs }),
  ).rejects.toMatchObject({
    code: "backup.staging_space_low",
    params: { neededBytes: 2000, availableBytes: 1999 },
  });
  expect(statfs).toHaveBeenCalledWith(f.stagingDir);
  expect(d.archive).not.toHaveBeenCalled();
  expect(backend.puts).toBe(0);
  expect(await readdir(f.stagingDir).catch(() => [])).toEqual([]);
});

it("proceeds when free space covers twice the database's size", async () => {
  const f = await fixture();
  const backend = new Watched("a", join(f.root, "a"));
  await runOnce({
    ...deps(f, [backend]),
    stagingEstimateBytes: async () => 1000,
    statfs: freeSpace(1_000_000),
  });
  expect(backend.puts).toBe(1);
  expect(await readdir(f.stagingDir)).toEqual([]);
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
    .mockResolvedValueOnce({ bavail: 100, bsize: 1 })
    .mockResolvedValue({ bavail: 999, bsize: 1 });
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

it("estimates from the venue database and its write-ahead file, counting a missing one as empty", async () => {
  const venueDir = await mkdtemp(join(tmpdir(), "sweep-staging-venue-"));
  dirs.push(venueDir);
  expect(await venueStagingEstimate(venueDir)).toBe(0);
  await writeFile(join(venueDir, VENUE_FILE), Buffer.alloc(300));
  expect(await venueStagingEstimate(venueDir)).toBe(300);
  await writeFile(join(venueDir, `${VENUE_FILE}${WAL_SUFFIX}`), Buffer.alloc(50));
  await writeFile(join(venueDir, "node.db"), Buffer.alloc(7000));
  expect(await venueStagingEstimate(venueDir)).toBe(350);
});
