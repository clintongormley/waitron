// Real PostgreSQL: runs pg_dump against the migrated database and checks the custom-format artifact.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
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
import { backupArchiveKey } from "./pg-dump.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";
import { locateSharedContainer } from "./testing/locate-shared-container.js";

const execFileAsync = promisify(execFile);

// A `db` handle is required by the deps type but never touched under an injected manifest
// builder, so the pure-DI fan-out/assembly tests hand in this inert stand-in.
const NO_DB = {} as Database;

// A fixed manifest, no journal read — keeps the fan-out/assembly tests off a real container.
const FIXED_MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  environment: "preproduction",
  modules: { core: 3 },
};
const fixedManifest: ManifestBuilder = async () => FIXED_MANIFEST;

// A fresh injectable `runDump` spy that writes the sentinel dump bytes — used by the fail-visible
// tests to assert the dump was NEVER called (a throw in the cheap collection must fail the tick
// before the dump). One per test so the call-count assertions stay isolated.
const dumpSpy = () =>
  vi.fn(async ({ outFile }: { outFile: string }) => writeFile(outFile, "DUMP-BYTES"));

// Write the full RECOVERY_FILES set under a fresh temp state dir, so `collectStateSecrets` succeeds.
// Omit one path (`skip`) to drive the fail-visible "incomplete state" case.
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

// A fake StorageBackend for unit tests: `list` honours the real interface's "newest-first" contract
// by returning keys in REVERSE insertion order (the most recently `put` — or directly seeded — key
// first), which is what lets the "prunes to retain" test below assert the actual survivor rather than
// only a count.
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
    databaseUrl: "postgres://x",
    recoveryKey: "recovery-key-1",
    stagingDir: staging,
    retain: 7,
    // A far age cap so these fan-out/count tests exercise the COUNT arm alone; the dual-retention
    // age arm is pinned by pruneBackend's own unit test below.
    retainDays: 3650,
    signal: new AbortController().signal,
    sleep: vi.fn(),
    log,
    now: () => new Date("2026-09-05T00:00:00Z"),
    runDump: async ({ outFile }: { outFile: string }) => {
      await writeFile(outFile, "DUMP-BYTES");
    },
  });

  // Decrypt one backend's artifact and unpack it back into named archive entries.
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
    // Encrypt-ONCE: byte-identical ciphertext to every backend.
    expect(b.objects.get(KEY)!.equals(a.objects.get(KEY)!)).toBe(true);
    // The ciphertext decrypts to the packed archive, whose `db.dump` entry is the raw dump.
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
    // Every RECOVERY_FILES path is captured under `secrets/`.
    for (const rel of RECOVERY_FILES) expect(entries.has(`secrets/${rel}`)).toBe(true);
    // Secrets retain their exact bytes.
    expect(entries.get("secrets/secrets.env")!.toString()).toBe("secrets.env-contents");
    // The manifest parses back to the builder's object.
    expect(JSON.parse(entries.get("manifest.json")!.toString())).toEqual(FIXED_MANIFEST);
  });

  it("captures backup.env + modules.json as secrets/<name> when present, skips them when absent", async () => {
    // The optional on-disk config a cold restore must bring back. Present in the state dir → packed as
    // `secrets/backup.env` / `secrets/modules.json` beside the RECOVERY_FILES secrets; absent → skipped
    // WITHOUT failing the tick (backups off / all-modules-default is a valid box). `makeStateDir` writes
    // only RECOVERY_FILES, so this test adds the two optional files itself.
    await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    await writeFile(join(stateDir, "modules.json"), '{"modules":{"fiscal-none":false}}\n');
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    const entries = entriesOf(a);
    expect(entries.get("secrets/backup.env")!.toString()).toBe("WAITRON_BACKUP_DIR=/mnt/usb\n");
    expect(entries.get("secrets/modules.json")!.toString()).toBe(
      '{"modules":{"fiscal-none":false}}\n',
    );

    // A SECOND state dir with neither optional file (only RECOVERY_FILES) → archive carries neither,
    // and the tick still succeeds. Proves absent-is-fine rather than a fatal short archive.
    const bare = await makeStateDir();
    try {
      const b = new FakeBackend("b");
      await runOnce({ ...deps([b]), stateDir: bare });
      const bareEntries = entriesOf(b);
      expect(bareEntries.has("secrets/backup.env")).toBe(false);
      expect(bareEntries.has("secrets/modules.json")).toBe(false);
      // The RECOVERY_FILES secrets are still there — only the optional ones were skipped.
      expect(bareEntries.has("secrets/secrets.env")).toBe(true);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("fail-visible: a throwing manifest build ships NO partial archive and never dumps", async () => {
    const a = new FakeBackend("a");
    const boom = new Error("journal unreadable");
    const failingManifest: ManifestBuilder = async () => {
      throw boom;
    };
    const runDump = dumpSpy();
    await expect(runOnce({ ...deps([a]), buildManifest: failingManifest, runDump })).rejects.toBe(
      boom,
    );
    // The throw happens before the first `put`, so nothing lands anywhere.
    expect(a.objects.size).toBe(0);
    // Fail-fast: the manifest is collected BEFORE the expensive dump, so the dump never ran.
    expect(runDump).not.toHaveBeenCalled();
  });

  it("fail-visible: an incomplete state dir (missing a recovery file) ships NO partial archive and never dumps", async () => {
    const a = new FakeBackend("a");
    const incompleteState = await makeStateDir("secrets.env"); // omit the vault key
    const runDump = dumpSpy();
    try {
      await expect(
        runOnce({ ...deps([a]), stateDir: incompleteState, runDump }),
      ).rejects.toMatchObject({
        code: "recovery.state_incomplete",
        params: { missing: "secrets.env" },
      });
      // collectStateSecrets throws before the fan-out — no partial archive is written.
      expect(a.objects.size).toBe(0);
      // Fail-fast: the secrets read happens BEFORE the expensive dump, so the dump never ran.
      expect(runDump).not.toHaveBeenCalled();
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
    // A LocalFsBackend fault (ENOSPC/EACCES/EROFS) is a NodeJS.ErrnoException, whose `.code` is a
    // fixed symbol carrying no secrets. codeOf() maps it to "unknown" (only AppErrors resolve), so
    // the raw errno is logged alongside to keep it diagnosable.
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

  it("prunes each backend to retain", async () => {
    const a = new FakeBackend("a");
    // Real stamped keys (a day or two before the run) so the age arm can read each object's own
    // timestamp; with retainDays far off, only the COUNT arm bites here.
    for (const d of ["2026-09-03T00:00:00Z", "2026-09-04T00:00:00Z"])
      a.objects.set(backupArchiveKey(new Date(d)), Buffer.from("old"));
    await runOnce({ ...deps([a]), retain: 1 });
    expect(a.objects.size).toBe(1); // only the newest survives
    // The newest is the archive this very run just wrote, not either pre-seeded fixture.
    expect(a.objects.has("waitron-20260905T000000Z.backup.enc")).toBe(true);
  });

  it("chmods the staging plaintext dump to 0600 before it is read/encrypted", async () => {
    // pg_dump writes with the process umask, which can leave the whole-DB plaintext
    // group/other-readable. runOnce chmods it to 0600 (owner-only) right after the dump and before
    // the encrypt/fan-out. The rm is in a `finally`, so we observe the mode from inside a backend's
    // `put` — the staged file still exists there, after the chmod. The runDump writes 0o644 so an
    // absent chmod would leave it 0o644 and fail this.
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
      runDump: async ({ outFile }: { outFile: string }) => {
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

// The loop shell (abort checks, sleep, error swallow) is unchanged from the pre-fan-out version of
// this file, but `runOnce` is a fresh function under the new `BackupSweepDeps` shape, so these are
// rewritten around backends rather than a bare `dir`. They pin the same three behaviours the old
// `runBackupSweep` suite pinned: one tick fans to every backend, a per-tick throw is logged as
// `backup.failed` and swallowed (the loop keeps going), and a non-`AppError` throw's code comes
// through as `"unknown"` rather than as a raw message that could carry the connection string.
describe("runBackupSweep (loop logic, injected runDump + sleep)", () => {
  let staging: string;
  let mediaDir: string;
  let stateDir: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-loop-staging-"));
    mediaDir = await mkdtemp(join(tmpdir(), "backup-loop-media-"));
    stateDir = await makeStateDir();
  });
  afterEach(async () => {
    for (const d of [staging, mediaDir, stateDir])
      if (d !== undefined) await rm(d, { recursive: true, force: true });
  });

  // Mirrors the `deps()` helper in the runOnce block: the constant loop fields in one place
  // (including the BR-2 archive deps — a `db` stand-in for backup reads, the module set, the
  // media resolver and state dir, and the injected manifest builder so the loop never needs a
  // real journal), with the per-test signal/sleep/log (and optional runDump/now) supplied as
  // overrides. `signal`/`sleep`/`log` are required here because every loop test drives its own
  // AbortController through them.
  type LoopOverrides = Partial<BackupSweepDeps> & Pick<BackupSweepDeps, "signal" | "sleep" | "log">;
  const loopDeps = (backend: StorageBackend, overrides: LoopOverrides): BackupSweepDeps => ({
    backends: [backend],
    db: NO_DB,
    modules: ALL_MODULES,
    environment: "preproduction",
    resolvers: { media: mediaDir },
    stateDir,
    buildManifest: fixedManifest,
    databaseUrl: "postgres://x",
    recoveryKey: "recovery-key-1",
    stagingDir: staging,
    // The loop now waits to a schedule, not a fixed `intervalMs`; a short interval keeps `nextFireMs`
    // close so the injected `sleep` drives the wait deterministically.
    schedule: { kind: "interval", ms: 10 },
    retain: 7,
    retainDays: 30,
    jitterSeed: "loop-node",
    // Only consulted for a wall-clock schedule; the interval loop tests never call it.
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
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
        runDump: async ({ outFile }) => {
          await writeFile(outFile, "DUMP-BYTES");
        },
        now: () => new Date("2026-09-05T00:00:00Z"),
        // Aborts on the first (and only) sleep, so the loop runs exactly one iteration then exits.
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

    // The loop must NOT die on a dump failure: the throw is caught, logged as a warn, and a second
    // iteration runs before the abort — the same "logged and swallowed" contract runRetentionSweep has.
    // A mutable clock the injected `sleep` advances by the chunk it is handed, so the schedule wait
    // completes deterministically and the next tick fires (no reliance on real wall-clock passing).
    let nowMs = Date.parse("2026-09-05T00:00:00Z");
    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: (level, event) => logged.push([level, event]),
        now: () => new Date(nowMs),
        runDump: async () => {
          dumpCalls += 1;
          throw new Error("pg_dump exploded");
        },
        sleep: async (chunk: number) => {
          ticks += 1;
          nowMs += chunk; // advance toward fireAt so the wait completes and the next tick runs
          if (ticks >= 2) controller.abort();
        },
      }),
    );

    expect(logged).toContainEqual(["warn", "backup.failed"]);
    // Swallowed, not fatal: a second dump was attempted after the first threw.
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
        runDump: async () => {
          throw new Error("plain error, not an AppError");
        },
        sleep: async () => {
          controller.abort();
        },
      }),
    );

    const failure = logged.find(([, event]) => event === "backup.failed");
    expect(failure).toBeDefined();
    // codeOf maps a non-AppError to "unknown" (error-code.ts) — never the raw message, which could
    // carry a connection string.
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
        // Aborts DURING the dump itself, not in `sleep` — pins the loop's second abort check
        // (immediately after the tick, before the sleep it would otherwise take).
        runDump: async ({ outFile }) => {
          controller.abort();
          await writeFile(outFile, "DUMP-BYTES");
        },
        sleep,
      }),
    );

    expect(backend.objects.size).toBe(1); // the in-flight tick still completed
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a tick that THROWS while aborted is a cancellation, not a backup.failed", async () => {
    // Pins tick()'s catch branch: the dump throws AND the signal is aborted (a shutdown that killed
    // an in-flight tick). That throw is a cancellation of the interrupted dump, so it must NOT be
    // logged as backup.failed — otherwise every routine shutdown mid-dump would emit a false failure.
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const log = vi.fn();

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log,
        // Abort first, THEN throw — so the catch sees `signal.aborted === true`.
        runDump: async () => {
          controller.abort();
          throw new Error("pg_dump killed by SIGTERM during shutdown");
        },
        sleep: vi.fn(),
      }),
    );

    expect(log).not.toHaveBeenCalledWith("warn", "backup.failed", expect.anything());
  });

  it("an already-aborted signal ends the loop without a dump or a backup.failed", async () => {
    const backend = new FakeBackend("only");
    const log = vi.fn();
    const runDump = vi.fn(async ({ outFile }: { outFile: string }) => {
      await writeFile(outFile, "DUMP-BYTES");
    });

    // A signal aborted before the loop even starts (shutdown raced boot) must not fire a dump into a
    // shutting-down box (M15), and must not log a spurious backup.failed.
    await runBackupSweep(
      loopDeps(backend, { signal: AbortSignal.abort(), log, sleep: vi.fn(), runDump }),
    );

    expect(runDump).not.toHaveBeenCalled();
    expect(backend.objects.size).toBe(0);
    expect(log).not.toHaveBeenCalledWith("warn", "backup.failed", expect.anything());
  });

  it("takes one dump immediately on start, then waits for the next fire", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const runDump = vi.fn(async ({ outFile }: { outFile: string }) => {
      await writeFile(outFile, "DUMP-BYTES");
    });

    // The immediate first dump runs BEFORE any nextFire wait: the very first `sleep` (the schedule
    // wait after the first tick) aborts the loop, so exactly one dump has happened by the time any
    // wait resolves.
    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: vi.fn(),
        now: () => new Date("2026-09-05T00:00:00Z"),
        runDump,
        sleep: async () => {
          expect(runDump).toHaveBeenCalledTimes(1); // dumped once already, before this first wait
          controller.abort();
        },
      }),
    );

    expect(runDump).toHaveBeenCalledTimes(1);
    expect(backend.objects.size).toBe(1);
  });

  it("a transient readClock rejection does not kill the sweep; it retries and a later tick runs", async () => {
    // Schedule resolution (readClock + nextFireMs) sat OUTSIDE tick()'s try/catch, so a single
    // readClock rejection propagated out of runBackupSweep and the sweep was dead until the next
    // reload/boot. A transient failure must be contained: log it, sleep a bounded delay, and RETRY —
    // never exit. Here readClock rejects on its FIRST call (after the immediate first tick) then
    // succeeds, and a later tick still runs.
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
        runDump: async ({ outFile }) => {
          dumpCalls += 1;
          await writeFile(outFile, "DUMP-BYTES");
        },
        // Advance the clock by each slept chunk so the schedule wait completes and the retried tick
        // fires; abort once a SECOND tick has run so the loop ends.
        sleep: async (chunk: number) => {
          nowMs += chunk;
          if (dumpCalls >= 2) controller.abort();
        },
      }),
    );

    // The rejection was contained (logged), the sweep did NOT die, and a second tick ran on retry.
    expect(logged).toContainEqual(["warn", "backup.schedule_failed"]);
    expect(dumpCalls).toBeGreaterThanOrEqual(2);
    expect(clockCalls).toBeGreaterThanOrEqual(2);
  });

  it("waits to a wall-clock schedule's nextFireMs, reading the clock each cycle", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    let clockReads = 0;

    // A wall-clock schedule makes the loop call readClock before computing nextFireMs. Abort on the
    // first schedule wait so exactly one clock read + one tick happen.
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
        runDump: async ({ outFile }) => {
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
    // Seed oldest-first so FakeBackend.list's reverse gives the newest-first the contract promises.
    // Ages from now: 20d, 10d, 2d, 1d, 0d.
    const ages = [20, 10, 2, 1, 0];
    for (const d of ages)
      backend.objects.set(backupArchiveKey(new Date(nowMs - d * day)), Buffer.from(`age-${d}`));

    // retain=3 keeps the newest 3 by COUNT (ages 0,1,2); retainDays=1 additionally prunes anything
    // strictly older than 1 day. Age 2d is WITHIN the count cap yet too old → it must still be pruned.
    await pruneBackend(backend, 3, 1, nowMs);

    const survivors = [...backend.objects.keys()].sort();
    expect(survivors).toEqual(
      [
        backupArchiveKey(new Date(nowMs)), // age 0 — within count, fresh
        backupArchiveKey(new Date(nowMs - 1 * day)), // age 1d — within count, exactly the cap (not >)
      ].sort(),
    );
    // The age-2d object sat at count index 2 (< retain 3) but was pruned by the AGE arm.
    expect(backend.objects.has(backupArchiveKey(new Date(nowMs - 2 * day)))).toBe(false);
    // The two over the count cap are gone too.
    expect(backend.objects.has(backupArchiveKey(new Date(nowMs - 10 * day)))).toBe(false);
    expect(backend.objects.has(backupArchiveKey(new Date(nowMs - 20 * day)))).toBe(false);
  });

  it("age is read from each key's own stamp, not filesystem mtime", async () => {
    // Every seeded object carries mtimeMs: 0 (FakeBackend), i.e. epoch — if prune used mtime, all
    // would read as ancient and be purged. It must instead read the age off the KEY's stamp, so a
    // fresh object survives despite the zero mtime.
    const backend = new FakeBackend("mtime");
    const nowMs = Date.parse("2026-09-20T00:00:00Z");
    const freshKey = backupArchiveKey(new Date(nowMs));
    backend.objects.set(freshKey, Buffer.from("fresh"));
    await pruneBackend(backend, 7, 1, nowMs);
    expect(backend.objects.has(freshKey)).toBe(true);
  });
});

// A real pg_dump against the shared test container — proves the custom-format invocation realPgDump
// issues actually produces a valid dump against postgres:18-alpine. The host here (macOS/CI) has no
// pg18 `pg_dump` on PATH, so we run the IDENTICAL argv realPgDump uses INSIDE the container via
// `docker exec`, then copy the file out and assert it is a non-empty custom-format dump (PGDMP magic).
// A skipped smoke proves nothing (CLAUDE.md §2), so this only degrades to a loud skip when the `docker`
// CLI or the container id genuinely cannot be resolved. Unchanged by BR-1 Task 5 — realPgDump itself
// did not change — carried over from the pre-fan-out version of this file (Task 4) rather than dropped
// in the rewrite, since it is the ONLY coverage of the real shell-out (pg-dump.ts says so explicitly).
const suite = useTemplateDb({ template: "manifest" });

// The DEFAULT (non-injected) manifest path against a REAL journal: proves runOnce's archive
// carries a real BackupManifest built off `suite.admin` (the owner connection —
// `appliedSchemaVersion` reads the `__drizzle_migrations_*` journal `app_user` cannot). A pure-DI
// test would never notice the default builder being wrong, so this drives it end to end. Needs
// `TESTCONTAINERS_RYUK_DISABLED=true` (§4).
describe("runOnce with the real buildManifest (useTemplateDb)", () => {
  let staging: string;
  let mediaDir: string;
  let stateDir: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-real-staging-"));
    mediaDir = await mkdtemp(join(tmpdir(), "backup-real-media-"));
    stateDir = await makeStateDir();
  });
  afterEach(async () => {
    for (const d of [staging, mediaDir, stateDir])
      if (d !== undefined) await rm(d, { recursive: true, force: true });
  });

  it("packs a real manifest (env + a positive core schema version) into the archive", async () => {
    const a = new FakeBackend("a");
    await runOnce({
      backends: [a],
      db: suite.admin, // owner read of the drizzle journal, which has no app_user SELECT grant
      modules: ALL_MODULES,
      environment: "preproduction",
      resolvers: { media: mediaDir },
      stateDir,
      // buildManifest intentionally OMITTED so the real default runs.
      databaseUrl: suite.pg.uri,
      recoveryKey: "recovery-key-1",
      stagingDir: staging,
      retain: 7,
      retainDays: 3650,
      signal: new AbortController().signal,
      log: vi.fn(),
      now: () => new Date("2026-09-05T00:00:00Z"),
      runDump: async ({ outFile }) => {
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
    // `core` is mandatory and migrated by the `manifest` template, so its applied version is positive.
    expect(manifest.modules.core).toBeGreaterThan(0);
  });
});

describe("realPgDump custom-format invocation (real container, docker exec)", () => {
  it("produces a non-empty PGDMP custom-format dump against postgres:18-alpine", async () => {
    const uri = new URL(suite.pg.uri);

    // Find the shared container by its published host port + the harness label.
    const containerId = await locateSharedContainer(uri, {
      tag: "backup-sweep smoke",
      unproven: "realPgDump's real invocation is UNPROVEN in this run.",
    });
    if (containerId === undefined) return;

    // Inside the container the server listens on localhost:5432; the clone db + superuser creds come
    // from the suite uri. This is the exact argv realPgDump builds (pg-dump.ts): custom format, --file,
    // connstring last.
    const dbName = uri.pathname.replace(/^\//, "");
    const internalConn = `postgresql://${uri.username}:${uri.password}@localhost:5432/${dbName}`;
    const inContainerFile = `/tmp/waitron-smoke-${process.pid}.dump`;

    await execFileAsync("docker", [
      "exec",
      containerId,
      "pg_dump",
      "--format=custom",
      "--file",
      inContainerFile,
      internalConn,
    ]);

    const outDir = await mkdtemp(join(tmpdir(), "backup-smoke-"));
    const hostFile = join(outDir, "smoke.dump");
    try {
      await execFileAsync("docker", ["cp", `${containerId}:${inContainerFile}`, hostFile]);
      const bytes = await readFile(hostFile);
      expect(bytes.length).toBeGreaterThan(0);
      // Custom-format archives begin with the 5-byte magic "PGDMP".
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("PGDMP");
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await execFileAsync("docker", ["exec", containerId, "rm", "-f", inContainerFile]).catch(
        () => {},
      );
    }
  }, 180_000);
});
