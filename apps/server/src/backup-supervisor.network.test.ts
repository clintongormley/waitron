// What the supervisor's status says about each destination when one of them is slow or failing,
// against a real migrated venue and real folder destinations.
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openVenueDatabase, runMigrations } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import type { BackupConfig } from "./backup-config.js";
import { BackupSupervisor, type SupervisedDestinationStatus } from "./backup-supervisor.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageCall } from "./storage-backend.js";
import "./errors.js";

let templateDir: string;
const scratch: string[] = [];

beforeAll(async () => {
  templateDir = await mkdtemp(join(tmpdir(), "waitron-bsupnet-template-"));
  scratch.push(templateDir);
  const store = await openVenueDatabase(templateDir);
  try {
    for (const options of migrationOptionsFor(manifestSets(), null)) {
      await runMigrations(store.venue, options);
    }
  } finally {
    await store.close();
  }
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

async function makeVenueDir(): Promise<string> {
  const dir = await tempDir("waitron-bsupnet-venue-");
  await cp(templateDir, dir, { recursive: true });
  return dir;
}

async function makeStateDir(): Promise<string> {
  const dir = await tempDir("waitron-bsupnet-state-");
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `dummy ${rel}`);
  return dir;
}

function config(
  destinations: { id: string; dir: string }[],
  overrides: Partial<BackupConfig> = {},
): BackupConfig {
  return {
    destinations: destinations.map((d) => ({ kind: "local-fs", ...d })),
    recoveryKey: "recovery-key-one-strong",
    schedule: { kind: "interval", ms: 60 * 60 * 1000 },
    retain: 7,
    retainDays: 30,
    staleAfterMs: 2 * 24 * 60 * 60 * 1000,
    destinationTimeoutMs: 15 * 60 * 1000,
    keyRotatedAt: undefined,
    ...overrides,
  };
}

type LogLine = { level: string; event: string; fields: Record<string, unknown> | undefined };

async function supervisor(
  cfg: () => BackupConfig,
  logs: LogLine[],
  statusReadTimeoutMs?: number,
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<BackupSupervisor> {
  return new BackupSupervisor({
    buildConfig: async () => cfg(),
    isManagedByEnvironment: () => false,
    readSingletonRole: () => "primary",
    venueDir: await makeVenueDir(),
    modules: ALL_MODULES,
    environment: "production",
    stateDir: await makeStateDir(),
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    log: (level, event, fields) =>
      logs.push({ level, event, fields: fields as Record<string, unknown> | undefined }),
    statusReadTimeoutMs,
    sleep,
  });
}

async function poll<T>(fn: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const end = Date.now() + 30_000;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() >= end) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const count = (logs: LogLine[], event: string, destination: string) =>
  logs.filter((l) => l.event === event && l.fields?.destination === destination).length;

/** Answers only when the caller gives up on it. */
function stall(call: StorageCall): Promise<never> {
  return new Promise((_resolve, reject) => {
    call.signal.addEventListener("abort", () => reject(new Error("stalled call stopped")), {
      once: true,
    });
  });
}

function byId(destinations: SupervisedDestinationStatus[], id: string) {
  const found = destinations.find((d) => d.id === id);
  if (found === undefined) throw new Error(`no destination ${id}`);
  return found;
}

async function destinations(sup: BackupSupervisor) {
  const s = await sup.status();
  if (!s.backupStatus.configured) throw new Error("not configured");
  return { status: s, destinations: s.backupStatus.destinations };
}

describe("BackupSupervisor status, one destination at a time", () => {
  it("a stalled remote beside a local destination that stored: only the local one stored under the current key, and status answers at the remote read's limit", async () => {
    const realPut = LocalFsBackend.prototype.putFile;
    const realList = LocalFsBackend.prototype.list;
    vi.spyOn(LocalFsBackend.prototype, "putFile").mockImplementation(function (
      this: LocalFsBackend,
      key,
      path,
      call,
    ) {
      return this.id === "remote" ? stall(call) : realPut.call(this, key, path, call);
    });
    vi.spyOn(LocalFsBackend.prototype, "list").mockImplementation(function (
      this: LocalFsBackend,
      prefix,
      call,
    ) {
      return this.id === "remote" ? stall(call) : realList.call(this, prefix, call);
    });
    const logs: LogLine[] = [];
    const cfg = config(
      [
        { id: "local", dir: await tempDir("waitron-bsupnet-local-") },
        { id: "remote", dir: await tempDir("waitron-bsupnet-remote-") },
      ],
      { destinationTimeoutMs: 300 },
    );
    const sup = await supervisor(() => cfg, logs, 400);
    try {
      await sup.reload();
      await poll(() =>
        count(logs, "backup.destination_completed", "local") > 0 &&
        count(logs, "backup.destination_failed", "remote") > 0
          ? true
          : undefined,
      );

      const started = Date.now();
      const { status, destinations: ds } = await destinations(sup);
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(5_000);
      expect(status.archiveUnderCurrentKey).toBe(true);
      expect(byId(ds, "local")).toEqual(
        expect.objectContaining({
          stale: false,
          readErrorCode: null,
          storedUnderCurrentKey: true,
          uploadErrorCode: null,
          pruneErrorCode: null,
        }),
      );
      expect(byId(ds, "remote")).toEqual({
        id: "remote",
        lastBackupAt: null,
        ageSeconds: null,
        stale: true,
        readErrorCode: "backup.destination_timed_out",
        storedUnderCurrentKey: false,
        uploadErrorCode: "backup.destination_timed_out",
        pruneErrorCode: null,
      });
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("an upload that stored and a pruning that failed stays stored under the current key, with the pruning's code", async () => {
    const realList = LocalFsBackend.prototype.list;
    let lists = 0;
    vi.spyOn(LocalFsBackend.prototype, "list").mockImplementation(function (
      this: LocalFsBackend,
      prefix,
      call,
    ) {
      // The sweep's pruning lists first; the status read after it lists for real.
      if (lists++ === 0)
        return Promise.reject(new AppError("backup.destination_key_invalid", { field: "key" }));
      return realList.call(this, prefix, call);
    });
    const logs: LogLine[] = [];
    const dir = await tempDir("waitron-bsupnet-local-");
    const sup = await supervisor(() => config([{ id: "local", dir }]), logs);
    try {
      await sup.reload();
      await poll(() =>
        count(logs, "backup.destination_prune_failed", "local") > 0 ? true : undefined,
      );
      const { status, destinations: ds } = await destinations(sup);
      expect(status.archiveUnderCurrentKey).toBe(true);
      expect(byId(ds, "local")).toEqual(
        expect.objectContaining({
          stale: false,
          storedUnderCurrentKey: true,
          uploadErrorCode: null,
          pruneErrorCode: "backup.destination_key_invalid",
        }),
      );
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("a later tick's success clears the upload code, and a later clean pruning clears the pruning code", async () => {
    const realPut = LocalFsBackend.prototype.putFile;
    const realList = LocalFsBackend.prototype.list;
    let failPut = true;
    let failPrune = false;
    vi.spyOn(LocalFsBackend.prototype, "putFile").mockImplementation(function (
      this: LocalFsBackend,
      key,
      path,
      call,
    ) {
      if (failPut)
        return Promise.reject(new AppError("backup.destination_key_invalid", { field: "key" }));
      return realPut.call(this, key, path, call);
    });
    vi.spyOn(LocalFsBackend.prototype, "list").mockImplementation(function (
      this: LocalFsBackend,
      prefix,
      call,
    ) {
      if (failPrune)
        return Promise.reject(new AppError("backup.destination_object_too_large", { maxBytes: 1 }));
      return realList.call(this, prefix, call);
    });
    // Each wait between ticks is held until the test lets it go, so no status read overlaps a tick.
    let sleeps = 0;
    let wake = () => {};
    const sleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        sleeps++;
        wake = () => setTimeout(resolve, ms);
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    const logs: LogLine[] = [];
    const dir = await tempDir("waitron-bsupnet-local-");
    const sup = await supervisor(
      () => config([{ id: "local", dir }], { schedule: { kind: "interval", ms: 1 } }),
      logs,
      undefined,
      sleep,
    );
    const local = async () => {
      const d = byId((await destinations(sup)).destinations, "local");
      return {
        stored: d.storedUnderCurrentKey,
        upload: d.uploadErrorCode,
        prune: d.pruneErrorCode,
      };
    };
    const records: unknown[] = [];
    try {
      await sup.reload();
      await poll(() => (sleeps >= 1 ? true : undefined));
      records.push(await local());

      failPut = false;
      failPrune = true;
      wake();
      await poll(() => (sleeps >= 2 ? true : undefined));
      failPrune = false;
      records.push(await local());

      wake();
      await poll(() => (sleeps >= 3 ? true : undefined));
      records.push(await local());

      failPut = true;
      wake();
      await poll(() => (sleeps >= 4 ? true : undefined));
      records.push(await local());
    } finally {
      await sup.stop();
    }
    expect(records).toEqual([
      { stored: false, upload: "backup.destination_key_invalid", prune: null },
      { stored: true, upload: null, prune: "backup.destination_object_too_large" },
      { stored: true, upload: null, prune: null },
      // A later failed upload does not undo the earlier store in this sweep.
      { stored: true, upload: "backup.destination_key_invalid", prune: null },
    ]);
  }, 60_000);

  it("a reload starts a fresh record, and a result the replaced sweep reports while reload() waits is not counted", async () => {
    const realList = LocalFsBackend.prototype.list;
    let lists = 0;
    let entered!: () => void;
    const oldPruneEntered = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const oldPruneReleased = new Promise<void>((r) => (release = r));
    vi.spyOn(LocalFsBackend.prototype, "list").mockImplementation(async function (
      this: LocalFsBackend,
      prefix,
      call,
    ) {
      // The first sweep's pruning, after its upload stored, is held until the reload waits on it.
      if (lists++ === 0) {
        entered();
        await oldPruneReleased;
        // Answers even though the reload has stopped this sweep, so the old sweep reports a result.
        return realList.call(this, prefix, { signal: new AbortController().signal });
      }
      return realList.call(this, prefix, call);
    });
    const realPut = LocalFsBackend.prototype.putFile;
    let failPuts = false;
    vi.spyOn(LocalFsBackend.prototype, "putFile").mockImplementation(function (
      this: LocalFsBackend,
      key,
      path,
      call,
    ) {
      if (failPuts)
        return Promise.reject(new AppError("backup.destination_key_invalid", { field: "key" }));
      return realPut.call(this, key, path, call);
    });
    const logs: LogLine[] = [];
    const dir = await tempDir("waitron-bsupnet-local-");
    const sup = await supervisor(() => config([{ id: "local", dir }]), logs);
    try {
      await sup.reload();
      await oldPruneEntered;
      failPuts = true;
      const reloading = sup.reload();
      release();
      await reloading;
      await poll(() => (count(logs, "backup.destination_failed", "local") > 0 ? true : undefined));
      const { status, destinations: ds } = await destinations(sup);
      expect(count(logs, "backup.destination_completed", "local")).toBe(1);
      expect(status.archiveUnderCurrentKey).toBe(false);
      expect(byId(ds, "local")).toEqual(
        expect.objectContaining({
          storedUnderCurrentKey: false,
          uploadErrorCode: "backup.destination_key_invalid",
          pruneErrorCode: null,
        }),
      );
      expect((await readdir(dir)).length).toBeGreaterThan(0);
    } finally {
      await sup.stop();
    }
  }, 60_000);

  it("closes each destination it built for a status read once the read has settled", async () => {
    const closed: string[] = [];
    const realList = LocalFsBackend.prototype.list;
    vi.spyOn(LocalFsBackend.prototype, "list").mockImplementation(function (
      this: LocalFsBackend,
      prefix,
      call,
    ) {
      return this.id === "remote" ? stall(call) : realList.call(this, prefix, call);
    });
    vi.spyOn(LocalFsBackend.prototype, "close").mockImplementation(function (this: LocalFsBackend) {
      closed.push(this.id);
      if (this.id === "local") throw new AppError("backup.reload_in_progress", {});
    });
    const logs: LogLine[] = [];
    const cfg = config([
      { id: "local", dir: await tempDir("waitron-bsupnet-local-") },
      { id: "remote", dir: await tempDir("waitron-bsupnet-remote-") },
    ]);
    // Stopped before the read, so every close seen after it is the status read's.
    const sup = await supervisor(() => cfg, logs, 100);
    await sup.reload();
    await sup.stop();
    closed.length = 0;
    const s = await sup.status();
    expect(s.backupStatus.configured).toBe(true);
    expect(closed.sort()).toEqual(["local", "remote"]);
    expect(logs).toContainEqual({
      level: "warn",
      event: "backup.destination_close_failed",
      fields: { destination: "local", errorCode: "backup.reload_in_progress" },
    });
  }, 60_000);
});
