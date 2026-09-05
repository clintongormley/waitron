// The scheduled backup worker (onboarding slice 4b-ii, widened for BR-1 storage fan-out). Each tick
// takes ONE `pg_dump` into a STAGING temp file, encrypts it ONCE under the operator's recovery key,
// then `put`s the SAME ciphertext to EVERY configured `StorageBackend` and prunes each to `retain` —
// then sleeps `intervalMs` before the next. The loop shell (abort-checked at the top and again before
// each sleep, a failed tick logged and swallowed) is unchanged from the pre-fan-out version and still
// MIRRORS `packages/sync/src/retention.ts`'s `runRetentionSweep`: a wedged pg_dump or an unreachable
// backend must never kill the loop and, with it, the box's only backup duty.
//
// A per-destination failure (a bad backend, a full disk, a network fault) is caught, logged as
// `backup.destination_failed`, and does NOT stop the remaining destinations — one bad backend must
// never cost the others their backup (fail-safe, CLAUDE.md §5: nothing may block a sale, and backup
// housekeeping is best-effort in the same spirit).

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { encryptArtifact } from "./artifact-cipher.js";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import { BACKUP_KEY_PREFIX, dumpFileName, realPgDump, type PgDumpRunner } from "./pg-dump.js";
import type { StorageBackend } from "./storage-backend.js";
import "./errors.js";

export interface BackupSweepDeps {
  /** Every destination this run fans the SAME encrypted artifact out to. */
  backends: StorageBackend[];
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
  /** Injectable so the filename stamp is deterministic under test; defaults to wall-clock now. */
  now?: () => Date;
}

/** The suffix an encrypted artifact carries on top of `dumpFileName`'s `waitron-<stamp>.dump`. */
const ENC_SUFFIX = ".enc";

/**
 * One backup: dump to a staging file, encrypt it once, fan the same ciphertext out to every backend,
 * and prune each backend to `retain`. Exported (rather than kept internal to `runBackupSweep`) so a
 * single tick can be unit-tested directly, without driving the loop's sleep/abort machinery.
 */
export async function runOnce(deps: Omit<BackupSweepDeps, "intervalMs" | "sleep">): Promise<void> {
  const runDump = deps.runDump ?? realPgDump;
  const now = deps.now ?? (() => new Date());
  await mkdir(deps.stagingDir, { recursive: true });
  const dumpName = dumpFileName(now());
  const staged = join(deps.stagingDir, dumpName);
  try {
    await runDump({ databaseUrl: deps.databaseUrl, outFile: staged, signal: deps.signal });
    // The staged file is the whole-DB plaintext dump. Lock it to 0600 (owner-only) the moment it
    // exists, matching the restrictive perms the encrypted artifact already gets on disk
    // (`LocalFsBackend.put` writes 0o600) — pg_dump's own umask can leave it group/other-readable.
    await chmod(staged, 0o600);
    const ciphertext = encryptArtifact(await readFile(staged), deps.recoveryKey);
    const key = `${dumpName}${ENC_SUFFIX}`;
    // Fan out to every backend concurrently; each keeps its own try/catch so one failure is logged
    // and swallowed rather than rejecting the batch — one bad backend never costs the others their
    // backup (fail-safe, per this file's header). `allSettled` therefore never rejects here.
    await Promise.allSettled(
      deps.backends.map(async (backend) => {
        try {
          await backend.put(key, ciphertext);
          await pruneBackend(backend, deps.retain);
          deps.log("info", "backup.destination_completed", { destination: backend.id, key });
        } catch (err) {
          deps.log("warn", "backup.destination_failed", {
            destination: backend.id,
            errorCode: codeOf(err),
          });
        }
      }),
    );
  } finally {
    await rm(staged, { force: true });
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
