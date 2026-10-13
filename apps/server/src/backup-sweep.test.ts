// Every case injects the archive step, which the supervisor binds to the venue store's `archiveTo`.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Database } from "@waitron/db";
import { setupVenue } from "./testing/venue-fixtures.js";
import { readVenueDetails, writeVenueDetails } from "./venue-details.js";
import { resolveVenueClock } from "./report-api.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decryptArtifact } from "./artifact-cipher.js";
import { unpackArchive } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import {
  type BackupSweepDeps,
  type ManifestBuilder,
  pruneBackend,
  runBackupSweep,
  runOnce,
} from "./backup-sweep.js";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import { backupArchiveKey, parseBackupArchiveKey } from "./backup-keys.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";

// Never touched under an injected manifest builder.
const NO_DB = {} as Database;

const FIXED_MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  environment: "preproduction",
  modules: { core: 3 },
};
const fixedManifest: ManifestBuilder = async () => FIXED_MANIFEST;

const archiveSpy = () => vi.fn(async (outFile: string) => writeFile(outFile, "DUMP-BYTES"));

async function makeStateDir(skip?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "backup-state-"));
  for (const rel of RECOVERY_FILES) {
    if (rel === skip) continue;
    const target = join(dir, rel);
    await mkdir(join(dir, dirname(rel)), { recursive: true });
    await writeFile(target, `${rel}-contents`);
  }
  return dir;
}

// `list` returns keys in REVERSE insertion order, honouring the interface's newest-first contract.
class FakeBackend implements StorageBackend {
  objects = new Map<string, Buffer>();
  constructor(
    readonly id: string,
    private failPut = false,
  ) {}
  async put(key: string, bytes: Uint8Array) {
    if (this.failPut) throw new Error("boom");
    this.objects.set(key, Buffer.from(bytes));
  }
  async putFile(key: string, path: string) {
    await this.put(key, await readFile(path));
  }
  async getFile(key: string, path: string) {
    await writeFile(path, await this.get(key));
  }
  async get(key: string) {
    return this.objects.get(key)!;
  }
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.keys()]
      .reverse()
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ key: k, size: 0, mtimeMs: 0 }));
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async deleteMany(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
  }
  close() {}
}

/** The one archive key a tick stamped 2026-09-05T00:00:00Z stored; its nonce is random. */
function keyIn(backend: FakeBackend): string {
  const keys = [...backend.objects.keys()].filter(
    (k) => parseBackupArchiveKey(k)?.timestamp.getTime() === Date.UTC(2026, 8, 5),
  );
  expect(keys).toHaveLength(1);
  return keys[0];
}

describe("runOnce (fan-out)", () => {
  let staging: string;
  let mediaDir: string;
  let stateDir: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-staging-"));
    mediaDir = await mkdtemp(join(tmpdir(), "backup-media-"));
    await writeFile(join(mediaDir, "abc123.jpg"), "IMG");
    stateDir = await makeStateDir();
  });
  afterEach(async () => {
    for (const d of [staging, mediaDir, stateDir])
      if (d !== undefined) await rm(d, { recursive: true, force: true });
  });

  const deps = (backends: StorageBackend[], log = vi.fn()) => ({
    backends,
    db: NO_DB,
    modules: ALL_MODULES,
    environment: "preproduction" as const,
    resolvers: { media: mediaDir },
    stateDir,
    buildManifest: fixedManifest,
    recoveryKey: "recovery-key-1",
    stagingDir: staging,
    retain: 7,
    // Far off, so only the count cap bites here; `pruneBackend`'s own case pins the age cap.
    retainDays: 3650,
    destinationTimeoutMs: 60_000,
    signal: new AbortController().signal,
    sleep: vi.fn(),
    log,
    now: () => new Date("2026-09-05T00:00:00Z"),
    archive: async (outFile: string) => {
      await writeFile(outFile, "DUMP-BYTES");
    },
  });

  const entriesOf = (backend: FakeBackend): Map<string, Buffer> =>
    new Map(
      unpackArchive(decryptArtifact(backend.objects.get(keyIn(backend))!, "recovery-key-1")).map(
        (e) => [e.name, Buffer.from(e.bytes)],
      ),
    );

  it("with one kept, keeps the archive it just stored over an earlier one from the same second", async () => {
    // The largest nonce a UUID can carry, so the key tie-break alone would keep this one.
    const earlier = backupArchiveKey(
      new Date("2026-09-05T00:00:00Z"),
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );
    const a = new FakeBackend("a");
    a.objects.set(earlier, Buffer.from("old"));
    await runOnce({ ...deps([a]), retain: 1 });
    expect([...a.objects.keys()]).toHaveLength(1);
    expect(a.objects.has(earlier)).toBe(false);
    expect(entriesOf(a).get("db.dump")!.toString()).toBe("DUMP-BYTES");
  });

  it("encrypts the archive once and fans the SAME ciphertext to every backend", async () => {
    const a = new FakeBackend("a");
    const b = new FakeBackend("b");
    await runOnce(deps([a, b]));
    const key = keyIn(a);
    expect(keyIn(b)).toBe(key);
    // Encrypted once: byte-identical ciphertext to every backend.
    expect(b.objects.get(key)!.equals(a.objects.get(key)!)).toBe(true);
    expect(entriesOf(a).get("db.dump")!.toString()).toBe("DUMP-BYTES");
  });

  it("assembles database and secret entries without copying the obsolete media directory", async () => {
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    const entries = entriesOf(a);
    // Photo bytes travel inside the database dump.
    expect(entries.has("manifest.json")).toBe(true);
    expect(entries.has("db.dump")).toBe(true);
    expect(entries.has("media/abc123.jpg")).toBe(false);
    expect(entries.has("secrets/secrets.env")).toBe(true);
    for (const rel of RECOVERY_FILES) expect(entries.has(`secrets/${rel}`)).toBe(true);
    expect(entries.get("secrets/secrets.env")!.toString()).toBe("secrets.env-contents");
    expect(JSON.parse(entries.get("manifest.json")!.toString())).toEqual(FIXED_MANIFEST);
  });

  it("captures backup.env + modules.json as secrets/<name> when present, skips them when absent", async () => {
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    await writeFile(join(stateDir, "modules.json"), '{"modules":{"fiscal-none":false}}\n');
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    const entries = entriesOf(a);
    expect(entries.get("secrets/backup.env")!.toString()).toBe("WAITRON_BACKUP_DIR=/mnt/usb\n");
    expect(entries.get("secrets/modules.json")!.toString()).toBe(
      '{"modules":{"fiscal-none":false}}\n',
    );

    // Absent, they are skipped and the tick still succeeds.
    const bare = await makeStateDir();
    try {
      const b = new FakeBackend("b");
      await runOnce({ ...deps([b]), stateDir: bare });
      const bareEntries = entriesOf(b);
      expect(bareEntries.has("secrets/backup.env")).toBe(false);
      expect(bareEntries.has("secrets/modules.json")).toBe(false);
      expect(bareEntries.has("secrets/secrets.env")).toBe(true);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("packs the archive in a fixed entry order: manifest, database, required state, optional state", async () => {
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    await writeFile(join(stateDir, "modules.json"), '{"modules":{}}\n');
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    const order = unpackArchive(decryptArtifact(a.objects.get(keyIn(a))!, "recovery-key-1")).map(
      (e) => e.name,
    );
    expect(order).toEqual([
      "manifest.json",
      "db.dump",
      ...RECOVERY_FILES.map((rel) => `secrets/${rel}`),
      "secrets/backup.env",
      "secrets/modules.json",
    ]);
  });

  it("lets other work run while it derives the key", async () => {
    const order: string[] = [];
    let timer!: Promise<void>;
    const sweepDeps = deps([
      new (class extends FakeBackend {
        override async put(key: string, bytes: Uint8Array) {
          order.push("encrypted");
          await super.put(key, bytes);
        }
      })("a"),
    ]);
    // The key is read once, as the encryption's argument, so the timer is set just before it
    // starts. The read count below fails the test if an earlier read is ever added.
    let keyReads = 0;
    Object.defineProperty(sweepDeps, "recoveryKey", {
      get: () => {
        keyReads += 1;
        timer = new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push("timer");
            resolve();
          }, 0),
        );
        return "recovery-key-1";
      },
    });
    await runOnce(sweepDeps);
    await timer;
    expect(keyReads).toBe(1);
    expect(order).toEqual(["timer", "encrypted"]);
  });

  it("fail-visible: a throwing manifest build ships NO partial archive and never dumps", async () => {
    const a = new FakeBackend("a");
    const boom = new Error("journal unreadable");
    const failingManifest: ManifestBuilder = async () => {
      throw boom;
    };
    const archive = archiveSpy();
    await expect(runOnce({ ...deps([a]), buildManifest: failingManifest, archive })).rejects.toBe(
      boom,
    );
    expect(a.objects.size).toBe(0);
    expect(archive).not.toHaveBeenCalled();
  });

  it("fail-visible: an incomplete state dir (missing a recovery file) ships NO partial archive and never dumps", async () => {
    const a = new FakeBackend("a");
    const incompleteState = await makeStateDir("secrets.env"); // omit the vault key
    const archive = archiveSpy();
    try {
      await expect(
        runOnce({ ...deps([a]), stateDir: incompleteState, archive }),
      ).rejects.toMatchObject({
        code: "recovery.state_incomplete",
        params: { missing: "secrets.env" },
      });
      expect(a.objects.size).toBe(0);
      expect(archive).not.toHaveBeenCalled();
    } finally {
      await rm(incompleteState, { recursive: true, force: true });
    }
  });

  it("a failing backend does not stop the others", async () => {
    const good = new FakeBackend("good");
    const bad = new FakeBackend("bad", true);
    const log = vi.fn();
    await runOnce(deps([bad, good], log));
    expect(good.objects.size).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "backup.destination_failed",
      expect.objectContaining({ destination: "bad" }),
    );
  });

  it("surfaces the errno of a NodeJS.ErrnoException in backup.destination_failed", async () => {
    const enospc = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const failing: StorageBackend = {
      id: "full-disk",
      async put() {
        throw enospc;
      },
      async putFile(key, path, call) {
        await this.put(key, await readFile(path), call);
      },
      async getFile(key, path, call) {
        await writeFile(path, await this.get(key, call));
      },
      async get() {
        return Buffer.alloc(0);
      },
      async list() {
        return [];
      },
      async delete() {},
      async deleteMany() {},
      close() {},
    };
    const log = vi.fn();
    await runOnce(deps([failing], log));
    expect(log).toHaveBeenCalledWith(
      "warn",
      "backup.destination_failed",
      expect.objectContaining({ destination: "full-disk", errorCode: "unknown", errno: "ENOSPC" }),
    );
  });

  it("records each destination's last outcome: a failure lands in outcomes.failed, a success clears it", async () => {
    const good = new FakeBackend("good");
    const bad = new FakeBackend("bad", true);
    const outcomes: BackupOutcomeHolder = { failed: new Map() };
    await runOnce({ ...deps([good, bad]), outcomes });
    expect(outcomes.failed.has("bad")).toBe(true);
    expect(outcomes.failed.get("bad")).toEqual({ at: "2026-09-05T00:00:00.000Z" });
    expect(outcomes.failed.has("good")).toBe(false);
    const recovered = new FakeBackend("bad");
    await runOnce({ ...deps([recovered]), outcomes });
    expect(outcomes.failed.has("bad")).toBe(false);
  });

  it("prunes each backend to retain", async () => {
    const a = new FakeBackend("a");
    for (const d of ["2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z"])
      a.objects.set(backupArchiveKey(new Date(d)), Buffer.from("old"));
    await runOnce({ ...deps([a]), retain: 1 });
    expect(a.objects.size).toBe(1);
    keyIn(a);
  });

  it("chmods the staged plaintext copy to 0600 before it is read/encrypted", async () => {
    // Observed from inside `put`, where the staged file still exists. The injected archive writes
    // 0o644, so a missing chmod fails this.
    const staged = join(staging, "waitron-20260905T000000Z.dump");
    let observedMode = -1;
    const probe: StorageBackend = {
      id: "probe",
      async put() {
        observedMode = (await stat(staged)).mode & 0o777;
      },
      async putFile(key, path, call) {
        await this.put(key, await readFile(path), call);
      },
      async getFile(key, path, call) {
        await writeFile(path, await this.get(key, call));
      },
      async get() {
        return Buffer.alloc(0);
      },
      async list() {
        return [];
      },
      async delete() {},
      async deleteMany() {},
      close() {},
    };
    await runOnce({
      ...deps([probe]),
      archive: async (outFile: string) => {
        await writeFile(outFile, "DUMP-BYTES", { mode: 0o644 });
      },
    });
    expect(observedMode).toBe(0o600);
  });

  it("leaves no staging file behind", async () => {
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    expect(await readdir(staging)).toEqual([]);
  });
});

describe("runBackupSweep (loop logic, injected archive + sleep)", () => {
  let staging: string;
  let stateDir: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-loop-staging-"));
    stateDir = await makeStateDir();
  });
  afterEach(async () => {
    for (const d of [staging, stateDir])
      if (d !== undefined) await rm(d, { recursive: true, force: true });
  });

  type LoopOverrides = Partial<BackupSweepDeps> & Pick<BackupSweepDeps, "signal" | "sleep" | "log">;
  const loopDeps = (backend: StorageBackend, overrides: LoopOverrides): BackupSweepDeps => ({
    backends: [backend],
    db: NO_DB,
    modules: ALL_MODULES,
    environment: "preproduction",
    resolvers: {},
    stateDir,
    buildManifest: fixedManifest,
    recoveryKey: "recovery-key-1",
    stagingDir: staging,
    schedule: { kind: "interval", ms: 10 },
    retain: 7,
    retainDays: 30,
    destinationTimeoutMs: 60_000,
    jitterSeed: "loop-node",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    archive: async (outFile: string) => {
      await writeFile(outFile, "DUMP-BYTES");
    },
    ...overrides,
  });

  it("dumps once, fans to the backend, logs backup.destination_completed, then exits on abort", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string]> = [];

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: (level, event) => logged.push([level, event]),
        archive: async (outFile) => {
          await writeFile(outFile, "DUMP-BYTES");
        },
        now: () => new Date("2026-09-05T00:00:00Z"),
        sleep: async () => {
          controller.abort();
        },
      }),
    );

    expect(backend.objects.size).toBe(1);
    expect(logged).toContainEqual(["info", "backup.destination_completed"]);
  });

  it("logs backup.failed and keeps looping when the dump throws, then exits cleanly", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string]> = [];
    let dumpCalls = 0;
    let ticks = 0;

    // `sleep` advances this clock by the chunk it is handed, so the next tick fires.
    let nowMs = Date.parse("2026-09-05T00:00:00Z");
    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: (level, event) => logged.push([level, event]),
        now: () => new Date(nowMs),
        archive: async () => {
          dumpCalls += 1;
          throw new Error("the archive copy exploded");
        },
        sleep: async (chunk: number) => {
          ticks += 1;
          nowMs += chunk;
          if (ticks >= 2) controller.abort();
        },
      }),
    );

    expect(logged).toContainEqual(["warn", "backup.failed"]);
    expect(dumpCalls).toBeGreaterThanOrEqual(2);
  });

  it("passes the AppError code through backup.failed's errorCode field", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: (level, event, fields) => logged.push([level, event, fields]),
        archive: async () => {
          throw new Error("plain error, not an AppError");
        },
        sleep: async () => {
          controller.abort();
        },
      }),
    );

    const failure = logged.find(([, event]) => event === "backup.failed");
    expect(failure).toBeDefined();
    // Never the raw message.
    expect(failure![2]).toMatchObject({ errorCode: "unknown" });
  });

  it("checks abort again after the tick and never sleeps when it aborted mid-tick", async () => {
    const controller = new AbortController();
    // Aborts once the archive is stored, since an abort before then stops the store.
    const backend = new (class extends FakeBackend {
      override async put(key: string, bytes: Uint8Array) {
        await super.put(key, bytes);
        controller.abort();
      }
    })("only");
    const sleep = vi.fn();

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: vi.fn(),
        sleep,
      }),
    );

    expect(backend.objects.size).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a tick that THROWS while aborted is a cancellation, not a backup.failed", async () => {
    // Otherwise every routine shutdown mid-copy would log a false failure.
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const log = vi.fn();

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log,
        archive: async () => {
          controller.abort();
          throw new Error("the archive copy was interrupted by shutdown");
        },
        sleep: vi.fn(),
      }),
    );

    expect(log).not.toHaveBeenCalledWith("warn", "backup.failed", expect.anything());
  });

  it("an already-aborted signal ends the loop without a dump or a backup.failed", async () => {
    const backend = new FakeBackend("only");
    const log = vi.fn();
    const archive = vi.fn(async (outFile: string) => {
      await writeFile(outFile, "DUMP-BYTES");
    });

    await runBackupSweep(
      loopDeps(backend, { signal: AbortSignal.abort(), log, sleep: vi.fn(), archive }),
    );

    expect(archive).not.toHaveBeenCalled();
    expect(backend.objects.size).toBe(0);
    expect(log).not.toHaveBeenCalledWith("warn", "backup.failed", expect.anything());
  });

  it("takes one dump immediately on start, then waits for the next fire", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const archive = vi.fn(async (outFile: string) => {
      await writeFile(outFile, "DUMP-BYTES");
    });

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: vi.fn(),
        now: () => new Date("2026-09-05T00:00:00Z"),
        archive,
        sleep: async () => {
          expect(archive).toHaveBeenCalledTimes(1);
          controller.abort();
        },
      }),
    );

    expect(archive).toHaveBeenCalledTimes(1);
    expect(backend.objects.size).toBe(1);
  });

  it("a transient readClock rejection does not kill the sweep; it retries and a later tick runs", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string]> = [];
    let clockCalls = 0;
    let dumpCalls = 0;
    let nowMs = Date.parse("2026-09-05T00:00:00Z");

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } },
        log: (level, event) => logged.push([level, event]),
        now: () => new Date(nowMs),
        readClock: async () => {
          clockCalls += 1;
          if (clockCalls === 1) throw new Error("clock read failed");
          return { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] };
        },
        archive: async (outFile) => {
          dumpCalls += 1;
          await writeFile(outFile, "DUMP-BYTES");
        },
        sleep: async (chunk: number) => {
          nowMs += chunk;
          if (dumpCalls >= 2) controller.abort();
        },
      }),
    );

    expect(logged).toContainEqual(["warn", "backup.schedule_failed"]);
    expect(dumpCalls).toBeGreaterThanOrEqual(2);
    expect(clockCalls).toBeGreaterThanOrEqual(2);
  });

  it("ends quietly when a clock read fails because the sweep is being stopped", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string]> = [];
    let sleeps = 0;

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } },
        log: (level, event) => logged.push([level, event]),
        now: () => new Date("2026-09-05T00:00:00Z"),
        readClock: async () => {
          controller.abort();
          throw new Error("clock read interrupted by shutdown");
        },
        archive: async (outFile) => {
          await writeFile(outFile, "DUMP-BYTES");
        },
        sleep: async () => {
          sleeps += 1;
        },
      }),
    );

    expect(backend.objects.size).toBe(1);
    expect(logged.filter(([, event]) => event === "backup.schedule_failed")).toEqual([]);
    expect(sleeps).toBe(0);
  });

  it("keeps an existing backup deadline through a venue edit and uses the saved clock next cycle", async () => {
    const venue = await setupVenue(suite.db);
    const controller = new AbortController();
    const backend = new FakeBackend("clock-edit");
    let now = new Date("2026-10-06T00:00:00Z");
    let edited = false;
    const archivedAt: string[] = [];
    const sleeps: number[] = [];
    await runBackupSweep(
      loopDeps(backend, {
        db: suite.db,
        signal: controller.signal,
        log: vi.fn(),
        now: () => now,
        schedule: { kind: "wall-clock", days: "daily", at: "auto" },
        readClock: () => withTransaction(suite.db, (tx) => resolveVenueClock(tx, venue.cfg.nodeId)),
        archive: async (outFile) => {
          archivedAt.push(now.toISOString());
          await writeFile(outFile, "DUMP-BYTES");
        },
        sleep: async (ms) => {
          sleeps.push(ms);
          if (!edited) {
            const initial = await withTransaction(suite.db, (tx) =>
              readVenueDetails(tx, venue.cfg),
            );
            await withTransaction(suite.db, (tx) =>
              writeVenueDetails(tx, venue.cfg, {
                expected: initial.details,
                changes: { timeZone: "UTC" },
              }),
            );
            edited = true;
          }
          now = new Date(now.getTime() + ms);
          if (archivedAt.length === 3) controller.abort();
        },
      }),
    );
    expect(archivedAt).toEqual([
      "2026-10-06T00:00:00.000Z",
      "2026-10-06T03:36:00.000Z",
      "2026-10-06T05:36:00.000Z",
    ]);
    expect(sleeps.slice(0, 6)).toEqual([3600000, 3600000, 3600000, 2160000, 3600000, 3600000]);
    expect(backend.objects.size).toBe(3);
  });

  it("exposes its retained interval deadline until abort clears it", async () => {
    const controller = new AbortController();
    const observed: Array<number | null> = [];
    const instant = Date.parse("2026-10-06T00:00:00Z");
    await runBackupSweep(
      loopDeps(new FakeBackend("preview"), {
        signal: controller.signal,
        log: vi.fn(),
        now: () => new Date(instant),
        onScheduled: (at) => observed.push(at),
        sleep: async () => {
          expect(observed.at(-1)).toBe(instant + 10);
          controller.abort();
        },
      }),
    );
    expect(observed).toEqual([null, instant + 10, null]);
  });

  it("waits to a wall-clock schedule's nextFireMs, reading the clock each cycle", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    let clockReads = 0;

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: vi.fn(),
        now: () => new Date("2026-09-05T00:00:00Z"),
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } },
        readClock: async () => {
          clockReads += 1;
          return { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] };
        },
        archive: async (outFile) => {
          await writeFile(outFile, "DUMP-BYTES");
        },
        sleep: async () => {
          controller.abort();
        },
      }),
    );

    expect(clockReads).toBe(1);
    expect(backend.objects.size).toBe(1);
  });
  it("takes an immediate archive after restart even before the last advertised deadline", async () => {
    const backend = new FakeBackend("restart");
    const archived: string[] = [];
    const advertised: Array<number | null> = [];
    for (const stamp of ["2026-11-03T12:00:00Z", "2026-11-03T12:00:01Z"]) {
      const controller = new AbortController();
      await runBackupSweep(
        loopDeps(backend, {
          signal: controller.signal,
          now: () => new Date(stamp),
          log: vi.fn(),
          schedule: { kind: "wall-clock", days: "daily", at: "auto" },
          readClock: async () => ({
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
            cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }],
          }),
          onScheduled: (at) => advertised.push(at),
          archive: async (path) => {
            archived.push(stamp);
            await writeFile(path, "DUMP-BYTES");
          },
          sleep: async () => {
            expect(advertised.at(-1)).toBe(Date.parse("2026-11-04T06:36:00Z"));
            controller.abort();
          },
        }),
      );
    }
    expect(archived).toEqual(["2026-11-03T12:00:00Z", "2026-11-03T12:00:01Z"]);
    expect(backend.objects.size).toBe(2);
  });

  it("keeps an advertised archive deadline through dated replace/cancel and recomputes from the next date", async () => {
    const controller = new AbortController();
    let abortAfterStore = false;
    const backend = new (class extends FakeBackend {
      override async put(key: string, bytes: Uint8Array) {
        await super.put(key, bytes);
        if (abortAfterStore) controller.abort();
      }
    })("dated");
    let now = new Date("2026-11-03T12:00:00Z");
    let changes = [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }];
    const archived: string[] = [];
    const deadlines: Array<number | null> = [];
    let waits = 0;
    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        now: () => now,
        log: vi.fn(),
        schedule: { kind: "wall-clock", days: "daily", at: "auto" },
        readClock: async () => ({
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          cutoverChanges: changes,
        }),
        onScheduled: (at) => deadlines.push(at),
        archive: async (outFile) => {
          archived.push(now.toISOString());
          await writeFile(outFile, "DUMP-BYTES");
          if (archived.length === 3) abortAfterStore = true;
        },
        sleep: async (ms) => {
          waits++;
          if (waits === 1) changes = [{ effectiveBusinessDay: "2026-11-04", dayCutover: "03:00" }];
          if (waits === 2) changes = [];
          if (waits === 3) changes = [{ effectiveBusinessDay: "2026-11-04", dayCutover: "03:00" }];
          expect(deadlines.at(-1)).toBe(
            Date.parse(archived.length === 1 ? "2026-11-04T06:36:00Z" : "2026-11-05T02:36:00Z"),
          );
          now = new Date(now.getTime() + ms);
        },
      }),
    );
    expect(archived).toEqual([
      "2026-11-03T12:00:00.000Z",
      "2026-11-04T06:36:00.000Z",
      "2026-11-05T02:36:00.000Z",
    ]);
    expect(backend.objects.size).toBe(3);
  });
});

describe("pruneBackend (dual count + age retention)", () => {
  it("prunes by count AND age, whichever bites first", async () => {
    const backend = new FakeBackend("dual");
    const nowMs = Date.parse("2026-09-20T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const key = (ms: number) =>
      backupArchiveKey(new Date(ms), "00000000-0000-4000-8000-000000000000");
    const ages = [20, 10, 2, 1, 0];
    for (const d of ages) backend.objects.set(key(nowMs - d * day), Buffer.from(`age-${d}`));

    // Age 2d is within the count cap of 3 but past the 1-day age cap.
    await pruneBackend(backend, 3, 1, nowMs, { signal: new AbortController().signal });

    const survivors = [...backend.objects.keys()].sort();
    expect(survivors).toEqual(
      [
        key(nowMs),
        key(nowMs - 1 * day), // exactly the age cap, which is kept
      ].sort(),
    );
    expect(backend.objects.has(key(nowMs - 2 * day))).toBe(false);
    expect(backend.objects.has(key(nowMs - 10 * day))).toBe(false);
    expect(backend.objects.has(key(nowMs - 20 * day))).toBe(false);
  });

  it("age is read from each key's own stamp, not filesystem mtime", async () => {
    // FakeBackend reports every mtime as 0, so an mtime-based prune would delete this.
    const backend = new FakeBackend("mtime");
    const nowMs = Date.parse("2026-09-20T00:00:00Z");
    const freshKey = backupArchiveKey(new Date(nowMs));
    backend.objects.set(freshKey, Buffer.from("fresh"));
    await pruneBackend(backend, 7, 1, nowMs, { signal: new AbortController().signal });
    expect(backend.objects.has(freshKey)).toBe(true);
  });

  it("leaves a listed name the parser rejects and prunes the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-prune-odd-"));
    try {
      const nowMs = Date.UTC(2026, 9, 13);
      const fresh = backupArchiveKey(new Date(Date.UTC(2026, 9, 12)));
      const oldPlain = backupArchiveKey(new Date(Date.UTC(2025, 0, 2)));
      const oldOdd = "waitron-20250101T000000Z-a\\b.backup.enc";
      for (const name of [fresh, oldPlain, oldOdd]) await writeFile(join(dir, name), "x");

      await pruneBackend(new LocalFsBackend("odd", dir), 5, 30, nowMs, {
        signal: new AbortController().signal,
      });

      expect((await readdir(dir)).sort()).toEqual([fresh, oldOdd].sort());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not count a name the parser rejects toward the kept newest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-prune-odd-slot-"));
    try {
      const nowMs = Date.UTC(2026, 9, 13);
      const plain = backupArchiveKey(new Date(Date.UTC(2026, 9, 10)));
      const odd = "waitron-20261011T000000Z-a\\b.backup.enc";
      await writeFile(join(dir, plain), "x");
      await writeFile(join(dir, odd), "x");
      await utimes(join(dir, plain), 1000, 1000);
      await utimes(join(dir, odd), 2000, 2000);

      await pruneBackend(new LocalFsBackend("odd", dir), 1, 3650, nowMs, {
        signal: new AbortController().signal,
      });

      expect((await readdir(dir)).sort()).toEqual([plain, odd].sort());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
describe("pruneBackend (which names it reads, in what order, and how it deletes)", () => {
  const call = () => ({ signal: new AbortController().signal });
  const nowMs = Date.UTC(2026, 9, 13);
  const day = 24 * 60 * 60 * 1000;
  const nonce = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

  // Lists in exactly the order given, and records every delete it is asked for.
  function recordingBackend(listed: string[], list?: () => Promise<StoredObject[]>) {
    const record = { batches: [] as string[][], singles: [] as string[], maxInFlight: 0 };
    let inFlight = 0;
    const backend: StorageBackend = {
      id: "recording",
      put: async () => {},
      putFile: async () => {},
      getFile: async () => {},
      get: async () => Buffer.alloc(0),
      close: () => {},
      list: list ?? (async () => listed.map((key) => ({ key, size: 0, mtimeMs: 0 }))),
      delete: async (key) => {
        record.singles.push(key);
      },
      deleteMany: async (keys) => {
        inFlight++;
        record.maxInFlight = Math.max(record.maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        record.batches.push([...keys]);
        inFlight--;
      },
    };
    return { backend, record };
  }

  it("never deletes a malformed, foreign or old-format name, and none of them takes a kept slot", async () => {
    const newest = backupArchiveKey(new Date(nowMs - 1 * day), nonce(1));
    const older = backupArchiveKey(new Date(nowMs - 2 * day), nonce(2));
    const foreign = [
      "waitron-20261012T235959Z.backup.enc",
      `waitron-20261012T235959Z-${nonce(0xabc).toUpperCase()}.backup.enc`,
      `waitron-20261012T235959Z-${nonce(4)}.backup.enc.part`,
      `waitron-20261332T000000Z-${nonce(5)}.backup.enc`,
      "waitron-notes.txt",
    ];
    const { backend, record } = recordingBackend([...foreign, newest, older]);
    await pruneBackend(backend, 1, 3650, nowMs, call());
    expect(record.batches).toEqual([[older]]);
    expect(record.singles).toEqual([]);
  });

  it("keeps the larger key of two archives from the same second, whatever order the list gives", async () => {
    const at = new Date(nowMs - day);
    const low = backupArchiveKey(at, nonce(1));
    const high = backupArchiveKey(at, nonce(2));
    for (const listed of [
      [low, high],
      [high, low],
    ]) {
      const { backend, record } = recordingBackend(listed);
      await pruneBackend(backend, 1, 3650, nowMs, call());
      expect(record.batches).toEqual([[low]]);
    }
  });

  it("keeps the archive this run just stored over a same-second archive with a larger key", async () => {
    const at = new Date(nowMs - day);
    const stored = backupArchiveKey(at, nonce(1));
    const other = backupArchiveKey(at, nonce(2));
    for (const listed of [
      [stored, other],
      [other, stored],
    ]) {
      const { backend, record } = recordingBackend(listed);
      await pruneBackend(backend, 1, 3650, nowMs, call(), stored);
      expect(record.batches).toEqual([[other]]);
    }
  });

  it("never deletes the archive this run just stored, even behind newer stamps", async () => {
    const stored = backupArchiveKey(new Date(nowMs - 2 * day), nonce(1));
    const newer = backupArchiveKey(new Date(nowMs - day), nonce(2));
    const { backend, record } = recordingBackend([newer, stored]);
    await pruneBackend(backend, 1, 3650, nowMs, call(), stored);
    expect(record.batches).toEqual([]);
  });

  it("orders by the stamp in the name, not by the file's mtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-prune-order-"));
    try {
      const newer = backupArchiveKey(new Date(nowMs - 1 * day), nonce(1));
      const older = backupArchiveKey(new Date(nowMs - 5 * day), nonce(2));
      await writeFile(join(dir, newer), "x");
      await writeFile(join(dir, older), "x");
      // The older archive was touched last, so a newest-by-mtime list puts it first.
      await utimes(join(dir, newer), 1000, 1000);
      await utimes(join(dir, older), 2000, 2000);

      await pruneBackend(new LocalFsBackend("order", dir), 1, 3650, nowMs, call());

      expect(await readdir(dir)).toEqual([newer]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deletes more than 1,000 expired archives in batches of at most 1,000, one batch at a time", async () => {
    const keep = backupArchiveKey(new Date(nowMs), nonce(0));
    const expired = Array.from({ length: 1005 }, (_, i) =>
      backupArchiveKey(new Date(nowMs - 10 * day - i * 1000), nonce(i + 1)),
    );
    const { backend, record } = recordingBackend([keep, ...expired]);
    await pruneBackend(backend, 5000, 1, nowMs, call());
    expect(record.batches.map((b) => b.length)).toEqual([1000, 5]);
    expect(record.batches.flat().sort()).toEqual([...expired].sort());
    expect(record.maxInFlight).toBe(1);
    expect(record.singles).toEqual([]);
  });

  it("asks for no delete when nothing is past either cap", async () => {
    const { backend, record } = recordingBackend([backupArchiveKey(new Date(nowMs), nonce(1))]);
    await pruneBackend(backend, 5, 30, nowMs, call());
    expect(record.batches).toEqual([]);
  });

  it("deletes nothing and rejects when the listing fails", async () => {
    const refused = new Error("list refused");
    const { backend, record } = recordingBackend([], () => Promise.reject(refused));
    await expect(pruneBackend(backend, 0, 0, nowMs, call())).rejects.toBe(refused);
    expect(record.batches).toEqual([]);
    expect(record.singles).toEqual([]);
  });
});

// The default manifest builder, which every case above replaces, against a real migrated venue.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

describe("runOnce with the real buildManifest (a migrated venue)", () => {
  let staging: string;
  let stateDir: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-real-staging-"));
    stateDir = await makeStateDir();
  });
  afterEach(async () => {
    for (const d of [staging, stateDir])
      if (d !== undefined) await rm(d, { recursive: true, force: true });
  });

  it("packs a real manifest (env + a positive core schema version) into the archive", async () => {
    const a = new FakeBackend("a");
    await runOnce({
      backends: [a],
      db: suite.db,
      modules: ALL_MODULES,
      environment: "preproduction",
      resolvers: {},
      stateDir,
      // No `buildManifest`, so the real default runs.
      recoveryKey: "recovery-key-1",
      stagingDir: staging,
      retain: 7,
      retainDays: 3650,
      destinationTimeoutMs: 60_000,
      signal: new AbortController().signal,
      log: vi.fn(),
      now: () => new Date("2026-09-05T00:00:00Z"),
      archive: async (outFile) => {
        await writeFile(outFile, "DUMP-BYTES");
      },
    });
    const entries = new Map(
      unpackArchive(decryptArtifact(a.objects.get(keyIn(a))!, "recovery-key-1")).map((e) => [
        e.name,
        Buffer.from(e.bytes),
      ]),
    );
    const manifest = JSON.parse(entries.get("manifest.json")!.toString()) as BackupManifest;
    expect(manifest.environment).toBe("preproduction");
    expect(manifest.createdAt).toBe("2026-09-05T00:00:00.000Z");
    expect(manifest.modules.core).toBeGreaterThan(0);
  });
});
