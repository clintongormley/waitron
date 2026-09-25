// Every case injects the archive step, which the supervisor binds to the venue store's `archiveTo`.
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
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
import { backupArchiveKey } from "./backup-keys.js";
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
}

describe("runOnce (fan-out)", () => {
  const KEY = "waitron-20260905T000000Z.backup.enc";
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
      unpackArchive(decryptArtifact(backend.objects.get(KEY)!, "recovery-key-1")).map((e) => [
        e.name,
        Buffer.from(e.bytes),
      ]),
    );

  it("encrypts the archive once and fans the SAME ciphertext to every backend", async () => {
    const a = new FakeBackend("a");
    const b = new FakeBackend("b");
    await runOnce(deps([a, b]));
    expect(a.objects.has(KEY)).toBe(true);
    // Encrypted once: byte-identical ciphertext to every backend.
    expect(b.objects.get(KEY)!.equals(a.objects.get(KEY)!)).toBe(true);
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
    const order = unpackArchive(decryptArtifact(a.objects.get(KEY)!, "recovery-key-1")).map(
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
      async get() {
        return Buffer.alloc(0);
      },
      async list() {
        return [];
      },
      async delete() {},
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
    expect(a.objects.has("waitron-20260905T000000Z.backup.enc")).toBe(true);
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
      async get() {
        return Buffer.alloc(0);
      },
      async list() {
        return [];
      },
      async delete() {},
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
    const { readdir } = await import("node:fs/promises");
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
    jitterSeed: "loop-node",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
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
    const backend = new FakeBackend("only");
    const sleep = vi.fn();

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: vi.fn(),
        archive: async (outFile) => {
          controller.abort();
          await writeFile(outFile, "DUMP-BYTES");
        },
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
          return { timeZone: "Europe/Madrid", dayCutover: "05:00" };
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
          return { timeZone: "Europe/Madrid", dayCutover: "05:00" };
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
});

describe("pruneBackend (dual count + age retention)", () => {
  it("prunes by count AND age, whichever bites first", async () => {
    const backend = new FakeBackend("dual");
    const nowMs = Date.parse("2026-09-20T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    // Seeded oldest-first, so `list` returns them newest-first.
    const ages = [20, 10, 2, 1, 0];
    for (const d of ages)
      backend.objects.set(backupArchiveKey(new Date(nowMs - d * day)), Buffer.from(`age-${d}`));

    // Age 2d is within the count cap of 3 but past the 1-day age cap.
    await pruneBackend(backend, 3, 1, nowMs);

    const survivors = [...backend.objects.keys()].sort();
    expect(survivors).toEqual(
      [
        backupArchiveKey(new Date(nowMs)),
        backupArchiveKey(new Date(nowMs - 1 * day)), // exactly the age cap, which is kept
      ].sort(),
    );
    expect(backend.objects.has(backupArchiveKey(new Date(nowMs - 2 * day)))).toBe(false);
    expect(backend.objects.has(backupArchiveKey(new Date(nowMs - 10 * day)))).toBe(false);
    expect(backend.objects.has(backupArchiveKey(new Date(nowMs - 20 * day)))).toBe(false);
  });

  it("age is read from each key's own stamp, not filesystem mtime", async () => {
    // FakeBackend reports every mtime as 0, so an mtime-based prune would delete this.
    const backend = new FakeBackend("mtime");
    const nowMs = Date.parse("2026-09-20T00:00:00Z");
    const freshKey = backupArchiveKey(new Date(nowMs));
    backend.objects.set(freshKey, Buffer.from("fresh"));
    await pruneBackend(backend, 7, 1, nowMs);
    expect(backend.objects.has(freshKey)).toBe(true);
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
      signal: new AbortController().signal,
      log: vi.fn(),
      now: () => new Date("2026-09-05T00:00:00Z"),
      archive: async (outFile) => {
        await writeFile(outFile, "DUMP-BYTES");
      },
    });
    const key = "waitron-20260905T000000Z.backup.enc";
    const entries = new Map(
      unpackArchive(decryptArtifact(a.objects.get(key)!, "recovery-key-1")).map((e) => [
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
