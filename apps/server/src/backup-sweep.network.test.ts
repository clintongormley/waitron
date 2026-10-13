import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { runOnce } from "./backup-sweep.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageBackend, StorageCall } from "./storage-backend.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sweep-network-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(stateDir, rel), `${rel}-contents`);
  return { root, stateDir, stagingDir: join(root, "staging") };
}

const stamp = new Date("2026-10-06T00:00:00Z");

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
    archive: async (path: string) => {
      await writeFile(path, "DATABASE");
    },
  };
}

/** A bucket whose upload hears its signal but keeps reading the staged file for `lingerMs` more. */
class LingeringBucket extends LocalFsBackend {
  readonly seen = { aborted: false, stagedWhenSettled: false, settled: false };
  #enter = () => {};
  readonly entered = new Promise<void>((resolve) => (this.#enter = resolve));
  constructor(
    root: string,
    private readonly lingerMs: number,
    private readonly answer: "reject" | "resolve",
  ) {
    super("bucket", join(root, "bucket"));
  }
  override async putFile(_key: string, path: string, { signal }: StorageCall): Promise<void> {
    this.#enter();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    this.seen.aborted = true;
    await new Promise((resolve) => setTimeout(resolve, this.lingerMs));
    this.seen.stagedWhenSettled = await stat(path).then(
      () => true,
      () => false,
    );
    this.seen.settled = true;
    if (this.answer === "reject") throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }
}

type Result = {
  id: string;
  stored: boolean;
  uploadErrorCode: string | null;
  pruneErrorCode: string | null;
};

it("a stalled bucket times out on its own while the folder beside it stores, and staging outlives the transfer", async () => {
  const f = await fixture();
  const bucket = new LingeringBucket(f.root, 50, "reject");
  const folder = new LocalFsBackend("folder", join(f.root, "folder"));
  const results: Result[] = [];
  const outcomes = { failed: new Map<string, { at: string }>() };
  const onStored = vi.fn();
  const log = vi.fn();
  await runOnce({
    ...deps(f, [bucket, folder]),
    destinationTimeoutMs: 100,
    outcomes,
    onStored,
    log,
    onDestinationResult: (r: Result) => results.push(r),
  });
  expect(bucket.seen).toEqual({ aborted: true, stagedWhenSettled: true, settled: true });
  expect(results.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    {
      id: "bucket",
      stored: false,
      uploadErrorCode: "backup.destination_timed_out",
      pruneErrorCode: null,
    },
    { id: "folder", stored: true, uploadErrorCode: null, pruneErrorCode: null },
  ]);
  expect(outcomes.failed.has("bucket")).toBe(true);
  expect(outcomes.failed.has("folder")).toBe(false);
  expect(onStored).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith(
    "warn",
    "backup.destination_failed",
    expect.objectContaining({ destination: "bucket", errorCode: "backup.destination_timed_out" }),
  );
  expect(await readdir(f.stagingDir)).toEqual([]);
});

it("a prune failure after a stored upload is reported as a prune failure, not a failed upload", async () => {
  const f = await fixture();
  class PruneRefused extends LocalFsBackend {
    override async list(): Promise<never> {
      throw new AppError("backup.destination_request_failed", {
        operation: "list",
        key: "waitron-",
        status: 503,
        name: "ServiceUnavailable",
      });
    }
  }
  const results: Result[] = [];
  const outcomes = { failed: new Map<string, { at: string }>() };
  const log = vi.fn();
  await runOnce({
    ...deps(f, [new PruneRefused("bucket", join(f.root, "bucket"))]),
    outcomes,
    log,
    onDestinationResult: (r: Result) => results.push(r),
  });
  expect(results).toEqual([
    {
      id: "bucket",
      stored: true,
      uploadErrorCode: null,
      pruneErrorCode: "backup.destination_request_failed",
    },
  ]);
  expect(outcomes.failed.has("bucket")).toBe(false);
  expect(log).toHaveBeenCalledWith(
    "warn",
    "backup.destination_prune_failed",
    expect.objectContaining({
      destination: "bucket",
      errorCode: "backup.destination_request_failed",
    }),
  );
  expect(log).not.toHaveBeenCalledWith("warn", "backup.destination_failed", expect.anything());
});

it("a stop during a transfer reaches it, records no failure, and keeps staging until it settles", async () => {
  const f = await fixture();
  const stop = new AbortController();
  const bucket = new LingeringBucket(f.root, 50, "resolve");
  const failing = new LingeringBucket(f.root, 10, "reject");
  Object.defineProperty(failing, "id", { value: "failing" });
  const results: Result[] = [];
  const outcomes = { failed: new Map<string, { at: string }>() };
  const log = vi.fn();
  const run = runOnce({
    ...deps(f, [bucket, failing]),
    signal: stop.signal,
    outcomes,
    log,
    onDestinationResult: (r: Result) => results.push(r),
  });
  await Promise.all([bucket.entered, failing.entered]);
  stop.abort();
  await run;
  expect(bucket.seen).toEqual({ aborted: true, stagedWhenSettled: true, settled: true });
  expect(failing.seen.settled).toBe(true);
  expect(outcomes.failed.size).toBe(0);
  expect(results.filter((r) => !r.stored)).toEqual([]);
  expect(log).not.toHaveBeenCalledWith("warn", "backup.destination_failed", expect.anything());
  expect(log).not.toHaveBeenCalledWith(
    "warn",
    "backup.destination_prune_failed",
    expect.anything(),
  );
  expect(await readdir(f.stagingDir)).toEqual([]);
});

it("a stop during encryption reaches no destination and leaves no staged file", async () => {
  const f = await fixture();
  const stop = new AbortController();
  const putFile = vi.fn();
  const folder = new LocalFsBackend("folder", join(f.root, "folder"));
  folder.putFile = putFile;
  await expect(
    runOnce({
      ...deps(f, [folder]),
      signal: stop.signal,
      archive: async (path: string) => {
        await writeFile(path, Buffer.alloc(1024 * 1024));
        stop.abort();
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(putFile).not.toHaveBeenCalled();
  expect(await readdir(f.stagingDir)).toEqual([]);
});

it("a stop after one destination stored still reports that one, and not the one it stopped", async () => {
  const f = await fixture();
  const stop = new AbortController();
  const folder = new LocalFsBackend("folder", join(f.root, "folder"));
  const bucket = new LingeringBucket(f.root, 10, "reject");
  const results: Result[] = [];
  let folderReported = () => {};
  const reported = new Promise<void>((resolve) => (folderReported = resolve));
  const run = runOnce({
    ...deps(f, [bucket, folder]),
    signal: stop.signal,
    onDestinationResult: (r: Result) => {
      results.push(r);
      if (r.id === "folder") folderReported();
    },
  });
  await Promise.all([bucket.entered, reported]);
  stop.abort();
  await run;
  expect(bucket.seen.settled).toBe(true);
  expect(results).toEqual([
    { id: "folder", stored: true, uploadErrorCode: null, pruneErrorCode: null },
  ]);
});
