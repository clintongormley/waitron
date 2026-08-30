import { execFile } from "node:child_process";
import { readdir, rename, stat, unlink } from "node:fs/promises";
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

/**
 * Dump via `inner` to a `<outFile>.partial` temp name, then atomically `rename` it onto `outFile` only
 * on success. This is the guard that stops a TRUNCATED dump from surfacing as a fresh, recovery-ready
 * backup: a dump killed mid-write — the routine shutdown path (`backupController.abort()` → SIGTERM to
 * `pg_dump`) or a full disk — would otherwise leave a partial `waitron-*.dump` with a fresh mtime that
 * `readBackupStatus` reports as `lastBackupAt`/`stale:false`, a dangerously wrong "recovery-ready"
 * signal since backup IS the cold-recovery path (CLAUDE.md §5). The `.partial` suffix does NOT match
 * `DUMP_FILE_NAME`, so `readBackupStatus`/`pruneOldDumps` never count the temp file; `rename` is atomic
 * within a directory, so the final name only ever appears fully written. On any failure the leftover
 * `.partial` is removed best-effort (so partials don't accumulate) and the error is re-thrown so
 * `runBackupSweep` logs `backup.failed`. `inner` is injectable so this temp-then-rename logic is
 * unit-tested without spawning `pg_dump`.
 */
export async function dumpAtomic(
  args: { databaseUrl: string; outFile: string; signal?: AbortSignal },
  inner: PgDumpRunner,
): Promise<void> {
  const partial = `${args.outFile}.partial`;
  try {
    await inner({ databaseUrl: args.databaseUrl, outFile: partial, signal: args.signal });
    await rename(partial, args.outFile);
  } catch (err) {
    await unlink(partial).catch(() => {});
    throw err;
  }
}

// The real shell-out is environment-coupled (needs a live pg_dump binary + server), so it is exercised
// by Task 4's smoke rather than a unit test and stays v8-ignored here — the same posture time-health.ts
// takes for its `defaultRun`. The atomic temp-then-rename wrapper (`dumpAtomic`) is NOT ignored: it is
// unit-tested via an injected inner, so only the pg_dump spawn itself is uncovered.
/* v8 ignore start */
const pgDumpShellOut: PgDumpRunner = async ({ databaseUrl, outFile, signal }) => {
  // `--format=custom` so `pg_restore` can read it; the libpq connstring is the final positional arg.
  // Deliberately NO `--enable-row-security`: the default `row_security=off` dumps every row, which is
  // what a full backup needs (the privileged backup role, not the app pool's least-privileged one).
  //
  // The connstring (with password) is passed as an argv, visible via `ps`/`/proc` for the dump's
  // lifetime. This is standard `pg_dump` usage, accepted on a single-operator appliance box where the
  // operator is the only local user; if multi-user boxes ever matter, move the secret to `PGPASSFILE`
  // or `PGPASSWORD` and pass a password-less connstring.
  await execFileAsync("pg_dump", ["--format=custom", "--file", outFile, databaseUrl], { signal });
};

export const realPgDump: PgDumpRunner = (args) => dumpAtomic(args, pgDumpShellOut);
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
 * are ignored, and a missing `dir` is tolerated (returns without error). A candidate that is not a
 * regular file (e.g. a directory named like a dump) is skipped rather than unlinked — the same
 * `isFile()` guard `readBackupStatus` applies — so a `waitron-*.dump` DIR never throws EISDIR/EPERM
 * every tick. */
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
  await Promise.all(
    dumps.slice(retain).map(async (name) => {
      const path = join(dir, name);
      const info = await stat(path);
      if (!info.isFile()) return; // a dir named like a dump is not a backup — don't unlink
      await unlink(path);
    }),
  );
}
