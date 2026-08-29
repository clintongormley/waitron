// The scheduled local-backup worker (onboarding slice 4b-ii). Each tick takes ONE `pg_dump` of the
// box's database into `dir`, prunes to the newest `retain` dumps, and logs the outcome — then sleeps
// `intervalMs` before the next. It MIRRORS `packages/sync/src/retention.ts`'s `runRetentionSweep`
// exactly: abort-checked at the top and again before each sleep so `close()` stops it promptly, and a
// failed dump is logged and swallowed so a transient failure (a wedged pg_dump, a full disk) never
// kills the loop and, with it, the box's only local backup duty.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import { dumpFileName, pruneOldDumps, realPgDump, type PgDumpRunner } from "./pg-dump.js";

export interface BackupSweepDeps {
  /** Where the `.dump` files live. Created (recursively) each tick, so a wiped backup dir self-heals. */
  dir: string;
  /** The libpq connection string `pg_dump` dumps — the privileged backup role, not the app pool's. */
  databaseUrl: string;
  /** Idle interval between dumps (WAITRON_BACKUP_INTERVAL_MS). */
  intervalMs: number;
  /** How many newest dumps to keep; older ones are unlinked each tick (pruneOldDumps). */
  retain: number;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  log: Logger;
  /** Injectable for the loop test; defaults to the real `pg_dump` shell-out. */
  runDump?: PgDumpRunner;
  /** Injectable so the filename stamp is deterministic under test; defaults to wall-clock now. */
  now?: () => Date;
}

/**
 * Runs the scheduled backup loop until `signal` aborts. Each tick ensures `dir` exists, dumps into
 * `dir/waitron-<stamp>.dump`, prunes to the newest `retain`, and logs `backup.completed`; a throw
 * anywhere in the tick is logged as `backup.failed` (with the structured `errorCode`, never a raw
 * message that could carry the connection string) and swallowed so the next tick still runs.
 */
export async function runBackupSweep(deps: BackupSweepDeps): Promise<void> {
  const runDump = deps.runDump ?? realPgDump;
  const now = deps.now ?? (() => new Date());
  while (!deps.signal.aborted) {
    try {
      await mkdir(deps.dir, { recursive: true });
      const outFile = join(deps.dir, dumpFileName(now()));
      await runDump({ databaseUrl: deps.databaseUrl, outFile, signal: deps.signal });
      await pruneOldDumps(deps.dir, deps.retain);
      deps.log("info", "backup.completed", { file: outFile });
    } catch (err) {
      deps.log("warn", "backup.failed", { errorCode: codeOf(err) });
    }
    if (deps.signal.aborted) break;
    await deps.sleep(deps.intervalMs, deps.signal);
  }
}
