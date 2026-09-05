import { execFile } from "node:child_process";
import { rename, unlink } from "node:fs/promises";
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
 * on success. This is the guard that stops a TRUNCATED dump from being encrypted and fanned out as a
 * fresh, recovery-ready backup: a dump killed mid-write — the routine shutdown path
 * (`backupController.abort()` → SIGTERM to `pg_dump`) or a full disk — leaves only the `.partial`, so
 * the sweep's `readFile(staged)` (backup-sweep.ts) either reads a COMPLETE dump or fails with ENOENT
 * and never encrypts a truncated one, which would be a dangerously wrong "recovery-ready" artifact
 * since backup IS the cold-recovery path (CLAUDE.md §5). `rename` is atomic
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

/** The key-naming convention every backup artifact shares: `dumpFileName` builds names from it, and
 * both the sweep's prune (`backup-sweep.ts`) and the status reader (`backup-status.ts`) scan
 * `list(BACKUP_KEY_PREFIX)` for it. Single source of truth so the three cannot drift apart. */
export const BACKUP_KEY_PREFIX = "waitron-";

/** A filesystem-safe, lexically-sortable timestamp for `now`: basic ISO, no colons (Windows/tooling
 * safe) and second-precision, so a lexical sort of names built from it is a chronological sort, e.g.
 * `20260829T175501Z`. Shared by `dumpFileName` (the staging dump) and `backupArchiveKey` (the
 * fanned-out artifact), so the two cannot drift on how they stamp the SAME instant. */
function basicIsoStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** The pre-encryption STAGING dump filename for `now`: `waitron-<basic-ISO>.dump`, e.g.
 * `waitron-20260829T175501Z.dump`. This names only the raw `pg_dump` on disk; the fanned-out
 * artifact carries {@link backupArchiveKey}'s `.backup.enc` name instead (the two share the same
 * stamp so a run's staging file and its artifact line up). */
export function dumpFileName(now: Date): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}.dump`;
}

/** The fanned-out artifact KEY for `now`: `waitron-<basic-ISO>.backup.enc` — the full encrypted
 * backup archive (manifest + db dump + module non-DB state + state secrets), distinct from the
 * `.dump` STAGING name above. Pruning and freshness both scan `list(BACKUP_KEY_PREFIX)` (backup-sweep.ts /
 * backup-status.ts), which is suffix-agnostic, so this key is pruned and read fresh like any
 * `waitron-*` object. */
export function backupArchiveKey(now: Date): string {
  return `${BACKUP_KEY_PREFIX}${basicIsoStamp(now)}.backup.enc`;
}
