import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The backup slice's box-status contribution. `configured: false` is the deliberate N/A placeholder
 * used when no backup reader is wired (backup disabled). When a reader IS present it always reports
 * `configured: true`; the null fields (and `stale: true`) then mean "backup is on but nothing has been
 * written yet" — a state that must read as unhealthy, not as absent.
 */
export type BackupStatus =
  | { configured: false }
  | { configured: true; lastBackupAt: string | null; ageSeconds: number | null; stale: boolean };

/** Matches a `waitron-<stamp>.dump` filename, the convention `dumpFileName` (pg-dump.ts) emits and
 * `pruneOldDumps` filters on. Kept in step with that regex. */
const DUMP_NAME = /^waitron-.*\.dump$/;

/**
 * Scan `dir` for the newest `waitron-*.dump` FILE (by mtime) and summarise its freshness. Returns
 * `{ configured: true, lastBackupAt: <newest mtime ISO>, ageSeconds: floor((now - mtime)/1000),
 * stale: age > staleAfterMs }`. When no dump exists yet — an empty dir, only non-matching files, or a
 * missing dir — reports `{ configured: true, lastBackupAt: null, ageSeconds: null, stale: true }`: a
 * backup that has never run is stale by definition. A missing `dir` is tolerated (treated as no dumps);
 * any other filesystem fault propagates (fail-loud — the caller surfaces it, per the box-status
 * replication reader's posture).
 */
export async function readBackupStatus(
  dir: string,
  staleAfterMs: number,
  now: Date,
): Promise<Extract<BackupStatus, { configured: true }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { configured: true, lastBackupAt: null, ageSeconds: null, stale: true };
    }
    throw err;
  }

  let newestMs: number | null = null;
  for (const name of names) {
    if (!DUMP_NAME.test(name)) continue;
    const info = await stat(join(dir, name));
    if (!info.isFile()) continue; // a dir named like a dump is not a backup
    const mtimeMs = info.mtime.getTime();
    if (newestMs === null || mtimeMs > newestMs) newestMs = mtimeMs;
  }

  if (newestMs === null) {
    return { configured: true, lastBackupAt: null, ageSeconds: null, stale: true };
  }

  const ageMs = now.getTime() - newestMs;
  return {
    configured: true,
    lastBackupAt: new Date(newestMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    stale: ageMs > staleAfterMs,
  };
}
