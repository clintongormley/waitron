// The scheduled backup worker (onboarding slice 4b-ii, widened for BR-1 storage fan-out, then BR-2's
// full-archive assembly, then BR-1 Task 3's wall-clock scheduler). Each tick takes ONE `pg_dump` into
// a STAGING temp file, assembles the FULL backup archive around it (manifest.json + db.dump + module
// non-DB state + state secrets, packed by `packArchive`), encrypts the WHOLE archive ONCE under the
// operator's recovery key, then `put`s the SAME ciphertext to EVERY configured `StorageBackend` as
// `waitron-<stamp>.backup.enc` and prunes each by BOTH a count cap (`retain`) and an age cap
// (`retainDays`, measured off each artifact's own key stamp). The loop takes an immediate first dump
// on start, then waits to the schedule's next fire (`nextFireMs`) — sleeping in <=1h chunks so a
// clock/NTP jump is caught within ~1h (the fire instant is computed once per cycle, so a tz/cutover
// config change takes effect at the next fire, not mid-wait). It MIRRORS `packages/sync/src/retention.ts`'s
// `runRetentionSweep`: a wedged pg_dump or an unreachable backend is logged and swallowed and must
// never kill the loop and, with it, the box's only backup duty; an abort mid-tick is a cancellation,
// not a `backup.failed`.
//
// A per-destination fault that THROWS (a bad backend, a full disk, a network fault) is caught, logged
// as `backup.destination_failed`, and does NOT stop the remaining destinations — a throwing backend
// never costs the others their backup (fail-safe, CLAUDE.md §5: nothing may block a sale, and backup
// housekeeping is best-effort in the same spirit).
//
// A destination that HANGS rather than throws (an unresponsive mount, a stalled network write) is NOT
// abandoned mid-tick in v1: `Promise.allSettled` waits for every backend to settle, so a wedged `put`
// stalls the whole tick and teardown's `await backupWorker` blocks with it. This is the same
// between-ticks abort model the sibling sync/tunnel/retention sweep workers use — abort is checked at
// tick boundaries, not inside an in-flight backend call. An abort-aware per-destination timeout is a
// follow-on for when a network-latency backend (s3/sftp) lands; the only backend today is local-fs,
// where a `put` does not hang. It is deliberately NOT implemented here.

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { buildManifest, type BackupManifest } from "./backup-manifest.js";
import { collectModuleNonDbState } from "./backup-sources.js";
import type { BackupSchedule } from "./backup-config.js";
import { MAX_SLEEP_MS, nextFireMs, type ScheduleClock } from "./backup-schedule.js";
import type { DeploymentEnvironment } from "./config.js";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import {
  BACKUP_KEY_PREFIX,
  backupArchiveKey,
  backupArchiveTimestamp,
  dumpFileName,
  realPgDump,
  type PgDumpRunner,
} from "./pg-dump.js";
import { collectStateSecrets } from "./state-secrets.js";
import { OPTIONAL_BACKUP_STATE, collectOptionalStateFiles } from "./backup-optional-state.js";
import type { StorageBackend } from "./storage-backend.js";
import "./errors.js";

/** The manifest builder the sweep uses; matches {@link buildManifest}'s signature. Injectable so the
 * fan-out/archive-assembly tests stay pure-DI (no real journal), while the real DB integration is
 * covered by a `useTemplateDb` suite driving the default. */
export type ManifestBuilder = (deps: {
  readonly db: Database;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  readonly now: Date;
}) => Promise<BackupManifest>;

export interface BackupSweepDeps {
  /** Every destination this run fans the SAME encrypted artifact out to. */
  backends: StorageBackend[];
  /** The pool accepted by the boot probe: effective schema access and SELECT on the user
   * tables and sequences the dump needs, including every module's migration journal.
   * pg_dump uses the same connection string in a separate process. The app pool lacks journal
   * SELECT. If a journal read fails after boot, buildManifest fails the tick before pg_dump or archive
   * delivery, so an incomplete manifest cannot be shipped as a successful backup. */
  db: Database;
  /** The running composition's modules — their `backup.nonDbState` refs drive the media/etc. capture
   * and their names + applied schema versions populate the manifest. */
  modules: readonly WaitronModule[];
  /** Stamped into the manifest so BR-3's restore can refuse an incompatible target. */
  environment: DeploymentEnvironment;
  /** Maps a module's declared non-DB source id (e.g. `"media"`) to the absolute dir it resolves to
   * (`{ media: config.mediaDir }`) — see `collectModuleNonDbState`. */
  resolvers: Record<string, string>;
  /** State dir holding the RECOVERY_FILES secrets captured into `secrets/<path>` (state-secrets.ts). */
  stateDir: string;
  /** The libpq connection string pg_dump uses, with the same role and database as db. */
  databaseUrl: string;
  /** The operator-held passphrase the dump is encrypted under before it ever reaches a backend. */
  recoveryKey: string;
  /** Where the pre-encryption dump is staged. Created (recursively) each tick, so a wiped staging dir
   * self-heals; the staged file is always removed again before this tick returns. */
  stagingDir: string;
  /** When the next dump fires: a fixed interval or a wall-clock cadence (`backup-config.ts`). The
   * loop resolves it through `nextFireMs` after each tick. */
  schedule: BackupSchedule;
  /** The count cap of the dual-retention policy: how many newest `waitron-*` artifacts to keep per
   * backend by count; older-than-`retain` ones are deleted each tick. */
  retain: number;
  /** The age cap of the dual-retention policy: an artifact older than this many days is deleted even
   * if it is within the count cap. Age is read off the artifact's OWN key stamp
   * (`backupArchiveTimestamp`), never the filesystem mtime, so a clock jump cannot revive it. */
  retainDays: number;
  /** Node-stable seed for the `at: "auto"` jitter, so a fleet of boxes spreads its auto dumps across a
   * small window rather than firing in lockstep (the box's node id in production). */
  jitterSeed: string;
  /** The venue's wall clock (tz + business-day cutover) resolved fresh each cycle before computing the
   * next fire, so an operator's tz/cutover change is picked up. Consulted ONLY for a `wall-clock`
   * schedule; an `interval` schedule never calls it. */
  readClock: () => Promise<ScheduleClock>;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Fired once per tick when AT LEAST ONE destination stored the archive on that tick — the
   * in-process signal the supervisor uses to know an artifact was written under the CURRENT key. It
   * fires ONLY on a real store, so an all-destinations-failed tick (every `put` threw, swallowed as
   * `backup.destination_failed`) never fires it. */
  onStored?: () => void;
  log: Logger;
  /** Injectable for tests; defaults to the real `pg_dump` shell-out. */
  runDump?: PgDumpRunner;
  /** Injectable so the fan-out/archive-assembly tests need no real journal; defaults to the real
   * {@link buildManifest} (reads the schema versions off `db`). */
  buildManifest?: ManifestBuilder;
  /** Injectable so the filename stamp is deterministic under test; defaults to wall-clock now. */
  now?: () => Date;
}

/**
 * One backup: dump the DB to a staging file, then assemble the FULL backup archive — a manifest, the
 * DB dump, every module's non-DB state (the media store), and the state-dir secrets — encrypt the
 * whole archive ONCE, fan the same ciphertext out to every backend as `waitron-<stamp>.backup.enc`,
 * and prune each backend to `retain`. Exported (rather than kept internal to `runBackupSweep`) so a
 * single tick can be unit-tested directly, without driving the loop's sleep/abort machinery.
 *
 * FAIL-FAST: the manifest, the media capture, and the secrets read all happen BEFORE the expensive
 * `pg_dump`, so a throw in any of them (an unreadable journal, a missing recovery file →
 * `recovery.state_incomplete`) fails the tick WITHOUT re-dumping the whole DB every tick only to
 * throw. It is also fail-visible: the throw propagates out of `runOnce` to the tick's `backup.failed`
 * and NO partial archive is fanned out — an incomplete backup must never masquerade as a
 * recovery-ready one (CLAUDE.md §5, backup IS the cold-recovery path).
 */
export async function runOnce(
  deps: Omit<BackupSweepDeps, "schedule" | "sleep" | "jitterSeed" | "readClock">,
): Promise<void> {
  const runDump = deps.runDump ?? realPgDump;
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  const buildBackupManifest = deps.buildManifest ?? buildManifest;
  const stamp = (deps.now ?? (() => new Date()))();
  const dumpName = dumpFileName(stamp);
  const staged = join(deps.stagingDir, dumpName);
  // The staged file only comes into existence once `runDump` runs; the fail-fast collection below
  // can throw before that, so the `finally` guards its cleanup on this flag.
  let dumped = false;
  try {
    // Collect the cheap, throw-prone pieces FIRST — the manifest, the module non-DB state
    // (`media/<sha>`), the required state secrets (`secrets/<path>`), and the OPTIONAL state config
    // (`backup.env`/`modules.json`, absent-is-fine). A misconfigured box fails here before the
    // whole-DB dump is wasted (see the FAIL-FAST note above). They are independent, so they run
    // concurrently; `Promise.all` still rejects (and the tick still fails BEFORE the dump) if any
    // REQUIRED collector throws — the optional one only rejects on a non-ENOENT read fault, never on
    // a missing file. This changes only the COLLECTION order; the packed ENTRY order below is unchanged.
    const [manifest, secrets, nonDbState, optionalState] = await Promise.all([
      buildBackupManifest({
        db: deps.db,
        modules: deps.modules,
        environment: deps.environment,
        now: stamp,
      }),
      collectStateSecrets(deps.stateDir),
      collectModuleNonDbState(deps.modules, deps.resolvers),
      collectOptionalStateFiles(deps.stateDir, OPTIONAL_BACKUP_STATE),
    ]);

    // Cheap collection passed — now take the expensive dump into the staging file.
    await mkdir(deps.stagingDir, { recursive: true });
    await runDump({ databaseUrl: deps.databaseUrl, outFile: staged, signal: deps.signal });
    dumped = true;
    // The staged file is the whole-DB plaintext dump. Lock it to 0600 (owner-only) the moment it
    // exists, matching the restrictive perms the encrypted artifact already gets on disk
    // (`LocalFsBackend.put` writes 0o600) — pg_dump's own umask can leave it group/other-readable.
    await chmod(staged, 0o600);
    const dumpBytes = await readFile(staged);
    // Pack the archive in its fixed ENTRY order: index first, then the dump, then the module non-DB
    // state (`media/<sha>`), then the secrets (`secrets/<path>`) — the required RECOVERY_FILES first,
    // then any present OPTIONAL_BACKUP_STATE (`backup.env`/`modules.json`), also under `secrets/` so
    // the restore writes them back with no restore-side change.
    const entries: ArchiveEntry[] = [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: dumpBytes },
      ...nonDbState,
      ...Object.entries(secrets).map(([path, contents]) => ({
        name: `secrets/${path}`,
        bytes: Buffer.from(contents),
      })),
      ...Object.entries(optionalState).map(([name, contents]) => ({
        name: `secrets/${name}`,
        bytes: Buffer.from(contents),
      })),
    ];
    const ciphertext = encryptArtifact(packArchive(entries), deps.recoveryKey);
    const key = backupArchiveKey(stamp);
    // Fan out to every backend concurrently; each keeps its own try/catch so a THROWING failure is
    // logged and swallowed rather than rejecting the batch — a throwing backend never costs the
    // others their backup (fail-safe, per this file's header). `allSettled` therefore never rejects
    // here. (A HANGING backend is a different matter — see the header: `allSettled` waits for it, so
    // in v1 it stalls the tick rather than being abandoned.)
    let anyStored = false;
    await Promise.allSettled(
      deps.backends.map(async (backend) => {
        try {
          await backend.put(key, ciphertext);
          // The archive is now stored on this backend regardless of what prune does next; record the
          // success before prune so a later prune fault cannot mask a genuine store.
          anyStored = true;
          await pruneBackend(backend, deps.retain, deps.retainDays, nowMs);
          deps.log("info", "backup.destination_completed", { destination: backend.id, key });
        } catch (err) {
          // A `LocalFsBackend` fault is a `NodeJS.ErrnoException` (ENOSPC/EACCES/EROFS), for which
          // `codeOf` yields "unknown" (it only maps AppErrors). Surface the raw errno too — it is a
          // fixed symbol, not the path or message, so it carries no secrets — while keeping
          // `codeOf` for the AppError cases.
          deps.log("warn", "backup.destination_failed", {
            destination: backend.id,
            errorCode: codeOf(err),
            errno: (err as NodeJS.ErrnoException).code,
          });
        }
      }),
    );
    // Signal an in-process store ONLY when a destination actually stored the archive this tick — not
    // "a tick ran". An all-destinations-failed tick leaves `anyStored` false and never fires it.
    if (anyStored) deps.onStored?.();
  } finally {
    // Only the dump creates the staged file; a fail-fast tick that threw before it never staged
    // anything, so guard the cleanup on `dumped` rather than issuing a spurious `rm`.
    if (dumped) await rm(staged, { force: true });
  }
}

/** Dual-retention prune: delete a `waitron-*` artifact when it is EITHER past the count cap (`retain`
 * newest kept — `list` returns newest-first per the `StorageBackend` contract) OR older than
 * `retainDays`, whichever bites first. Age is measured off the artifact's OWN embedded key stamp
 * (`backupArchiveTimestamp`), NOT the filesystem `mtimeMs`: the stamp is the immutable dump time, so a
 * later clock change can never resurrect a window already past the age cap (spec §3.3). Exported so
 * the dual-cap policy is unit-tested directly without driving a full fan-out. */
export async function pruneBackend(
  backend: StorageBackend,
  retain: number,
  retainDays: number,
  nowMs: number,
): Promise<void> {
  const objects = await backend.list(BACKUP_KEY_PREFIX);
  const maxAgeMs = retainDays * 24 * 60 * 60 * 1000;
  const toDelete = objects.filter(
    (obj, i) => i >= retain || nowMs - backupArchiveTimestamp(obj.key).getTime() > maxAgeMs,
  );
  await Promise.all(toDelete.map((obj) => backend.delete(obj.key)));
}

/**
 * Runs the scheduled backup loop until `signal` aborts. It takes an immediate first dump on start
 * (enable/rotate/boot — preserving the pre-scheduler "runOnce first"), then repeatedly resolves the
 * schedule's next fire (`nextFireMs`) and sleeps toward it in <=`MAX_SLEEP_MS` (1h) chunks. The <=1h
 * wake catches a clock/NTP jump within ~1h; `fireAt` is captured once per cycle (before the wait, not
 * inside it), so a tz/day_cutover CONFIG change takes effect at the NEXT scheduled fire, not mid-wait.
 * A wall-clock schedule reads the venue clock (`readClock`) fresh each cycle; an interval needs none, so it uses a
 * UTC placeholder that `nextFireMs` ignores. A throw anywhere in a tick — including one that escaped
 * `runOnce`'s per-destination handling, e.g. the dump itself failing — is logged as `backup.failed`
 * (structured `errorCode`, never a raw message that could carry the connection string) and swallowed
 * so the next tick still runs; but an abort MID-tick is a cancellation, not a failure (M15). A
 * transient failure to RESOLVE the next fire (a `readClock` rejection) is contained the same way — it
 * is logged as `backup.schedule_failed`, the loop sleeps a bounded delay and retries, and never exits.
 */
export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  if (deps.signal.aborted) return; // don't fire a dump into a shutting-down box (M15)
  await tick(deps);
  while (!deps.signal.aborted) {
    // Resolve the next fire INSIDE a try: a wall-clock schedule reads the venue clock (`readClock`),
    // which can reject transiently (a tenant-config read fault). That rejection sat outside the loop's
    // error handling and propagated out of `runBackupSweep`, killing the box's only backup duty until
    // the next reload/boot. Contain it: log, sleep a bounded delay, and RETRY — never exit on a
    // transient schedule-resolution failure. An `interval` schedule never calls `readClock`.
    let fireAt: number;
    try {
      const clock =
        deps.schedule.kind === "wall-clock"
          ? await deps.readClock()
          : { timeZone: "UTC", dayCutover: "00:00" };
      fireAt = nextFireMs(deps.schedule, clock, now(), deps.jitterSeed);
    } catch (err) {
      if (deps.signal.aborted) break;
      deps.log("warn", "backup.schedule_failed", { errorCode: codeOf(err) });
      await deps.sleep(MAX_SLEEP_MS, deps.signal);
      continue;
    }
    // Sleep toward `fireAt` in <=1h chunks: each chunk re-checks `now()`, so a clock/NTP jump is
    // caught within ~1h. `fireAt` is fixed for this cycle (a tz/cutover change lands at the next fire).
    while (!deps.signal.aborted && now().getTime() < fireAt) {
      const chunk = Math.min(MAX_SLEEP_MS, fireAt - now().getTime());
      await deps.sleep(chunk, deps.signal);
    }
    if (deps.signal.aborted) break;
    await tick(deps);
  }
}

/** One loop iteration: run the tick, and translate its outcome into the loop's contract. A throw is
 * logged as `backup.failed` and swallowed UNLESS the signal aborted mid-tick, in which case the throw
 * is a cancellation of the in-flight dump, not a failure to record. */
async function tick(deps: BackupSweepDeps): Promise<void> {
  try {
    await runOnce(deps);
  } catch (err) {
    if (deps.signal.aborted) return; // an abort mid-tick is a cancellation, not a failure
    deps.log("warn", "backup.failed", { errorCode: codeOf(err) });
  }
}
