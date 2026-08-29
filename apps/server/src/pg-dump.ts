import { execFile } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Takes one `pg_dump` of `databaseUrl` into `outFile`. Injected so the backup duty can be unit-tested
 * without spawning `pg_dump`; `realPgDump` is the production shell-out (smoke-tested in Task 4, not
 * here). An `AbortSignal` lets the caller cancel a hung dump.
 */
export type PgDumpRunner = (args: {
  databaseUrl: string;
  outFile: string;
  signal?: AbortSignal;
}) => Promise<void>;

// The real shell-out is environment-coupled (needs a live pg_dump binary + server), so it is exercised
// by Task 4's smoke rather than a unit test and stays v8-ignored here — the same posture time-health.ts
// takes for its `defaultRun`.
/* v8 ignore start */
export const realPgDump: PgDumpRunner = async ({ databaseUrl, outFile, signal }) => {
  // `--format=custom` so `pg_restore` can read it; the libpq connstring is the final positional arg.
  // Deliberately NO `--enable-row-security`: the default `row_security=off` dumps every row, which is
  // what a full backup needs (the privileged backup role, not the app pool's least-privileged one).
  await execFileAsync("pg_dump", ["--format=custom", "--file", outFile, databaseUrl], { signal });
};
/* v8 ignore stop */

/** A filesystem-safe, lexically-sortable dump filename for `now`: `waitron-<basic-ISO>.dump`, e.g.
 * `waitron-20260829T175501Z.dump`. No colons (Windows/tooling safe) and second-precision basic ISO,
 * so a lexical sort of these names is a chronological sort — which is what `pruneOldDumps` relies on. */
export function dumpFileName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `waitron-${stamp}.dump`;
}

/** Matches the `waitron-<stamp>.dump` filenames `dumpFileName` emits — the single source of truth for
 * that convention, shared by `pruneOldDumps` here and `readBackupStatus` (backup-status.ts). */
export const DUMP_FILE_NAME = /^waitron-.*\.dump$/;

/** Keep the newest `retain` `waitron-*.dump` files in `dir` and unlink the rest. Newest-first is a
 * descending NAME sort, which equals age order because `dumpFileName` is sortable. Non-matching files
 * are ignored, and a missing `dir` is tolerated (returns without error). */
export async function pruneOldDumps(dir: string, retain: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const dumps = entries
    .filter((name) => DUMP_FILE_NAME.test(name))
    .sort()
    .reverse();
  await Promise.all(dumps.slice(retain).map((name) => unlink(join(dir, name))));
}
