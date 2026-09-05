// The scheduled backup worker (onboarding slice 4b-ii, widened for BR-1 storage fan-out, then BR-2's
// full-archive assembly). Each tick takes ONE `pg_dump` into a STAGING temp file, assembles the FULL
// backup archive around it (manifest.json + db.dump + module non-DB state + state secrets, packed by
// `packArchive`), encrypts the WHOLE archive ONCE under the operator's recovery key, then `put`s the
// SAME ciphertext to EVERY configured `StorageBackend` as `waitron-<stamp>.backup.enc` and prunes each
// to `retain` — then sleeps `intervalMs` before the next. The loop shell (abort-checked at the top and again before
// each sleep, a failed tick logged and swallowed) is unchanged from the pre-fan-out version and still
// MIRRORS `packages/sync/src/retention.ts`'s `runRetentionSweep`: a wedged pg_dump or an unreachable
// backend must never kill the loop and, with it, the box's only backup duty.
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
import type { DeploymentEnvironment } from "./config.js";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import {
  BACKUP_KEY_PREFIX,
  backupArchiveKey,
  dumpFileName,
  realPgDump,
  type PgDumpRunner,
} from "./pg-dump.js";
import { collectStateSecrets } from "./state-secrets.js";
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
  /** A PRIVILEGED pool (superuser/BYPASSRLS — the same role the dump uses) for {@link buildManifest}:
   * `appliedSchemaVersion` reads each module's `__drizzle_migrations_*` journal, on which `app_user`
   * holds NO SELECT, so the app pool would fail. NOT the app pool. */
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
  /** The libpq connection string `pg_dump` dumps — the privileged backup role, not the app pool's. */
  databaseUrl: string;
  /** The operator-held passphrase the dump is encrypted under before it ever reaches a backend. */
  recoveryKey: string;
  /** Where the pre-encryption dump is staged. Created (recursively) each tick, so a wiped staging dir
   * self-heals; the staged file is always removed again before this tick returns. */
  stagingDir: string;
  /** Idle interval between dumps (WAITRON_BACKUP_INTERVAL_MS). */
  intervalMs: number;
  /** How many newest `waitron-*` artifacts to keep per backend; older ones are deleted each tick. */
  retain: number;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
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
export async function runOnce(deps: Omit<BackupSweepDeps, "intervalMs" | "sleep">): Promise<void> {
  const runDump = deps.runDump ?? realPgDump;
  const buildBackupManifest = deps.buildManifest ?? buildManifest;
  const stamp = (deps.now ?? (() => new Date()))();
  const dumpName = dumpFileName(stamp);
  const staged = join(deps.stagingDir, dumpName);
  // The staged file only comes into existence once `runDump` runs; the fail-fast collection below
  // can throw before that, so the `finally` guards its cleanup on this flag.
  let dumped = false;
  try {
    // Collect the cheap, throw-prone pieces FIRST — the manifest, the module non-DB state
    // (`media/<sha>`), and the state secrets (`secrets/<path>`). A misconfigured box fails here
    // before the whole-DB dump is wasted (see the FAIL-FAST note above). The three are independent,
    // so they run concurrently; `Promise.all` still rejects (and the tick still fails BEFORE the
    // dump) if ANY of them throws. This changes only the COLLECTION order; the packed ENTRY order
    // below is unchanged.
    const [manifest, secrets, nonDbState] = await Promise.all([
      buildBackupManifest({
        db: deps.db,
        modules: deps.modules,
        environment: deps.environment,
        now: stamp,
      }),
      collectStateSecrets(deps.stateDir),
      collectModuleNonDbState(deps.modules, deps.resolvers),
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
    // state (`media/<sha>`), then the secrets (`secrets/<path>`).
    const entries: ArchiveEntry[] = [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: dumpBytes },
      ...nonDbState,
      ...Object.entries(secrets).map(([path, contents]) => ({
        name: `secrets/${path}`,
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
    await Promise.allSettled(
      deps.backends.map(async (backend) => {
        try {
          await backend.put(key, ciphertext);
          await pruneBackend(backend, deps.retain);
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
  } finally {
    // Only the dump creates the staged file; a fail-fast tick that threw before it never staged
    // anything, so guard the cleanup on `dumped` rather than issuing a spurious `rm`.
    if (dumped) await rm(staged, { force: true });
  }
}

/** Keep the newest `retain` `waitron-*` artifacts on `backend` and delete the rest. `list` returns
 * newest-first (the `StorageBackend` contract), so the surplus is simply everything past `retain`. */
async function pruneBackend(backend: StorageBackend, retain: number): Promise<void> {
  const objects = await backend.list(BACKUP_KEY_PREFIX);
  await Promise.all(objects.slice(retain).map((obj) => backend.delete(obj.key)));
}

/**
 * Runs the scheduled backup loop until `signal` aborts, calling `runOnce` each tick. A throw anywhere
 * in the tick — including one that escaped `runOnce`'s own per-destination handling, e.g. the dump
 * itself failing — is logged as `backup.failed` (with the structured `errorCode`, never a raw message
 * that could carry the connection string) and swallowed so the next tick still runs.
 */
export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  while (!deps.signal.aborted) {
    try {
      await runOnce(deps);
    } catch (err) {
      deps.log("warn", "backup.failed", { errorCode: codeOf(err) });
    }
    if (deps.signal.aborted) break;
    await deps.sleep(deps.intervalMs, deps.signal);
  }
}
