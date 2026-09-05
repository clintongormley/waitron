import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Restores one `pg_dump --format=custom` archive (`inFile`) into `databaseUrl`. The symmetric twin of
 * `pg-dump.ts`'s {@link PgDumpRunner}: injected so BR-3's restore duty can be unit-tested without
 * spawning `pg_restore`; {@link realPgRestore} is the production shell-out (proven by the real-container
 * fiscal receipt in `pg-restore.test.ts`, not a unit test). An `AbortSignal` lets the caller cancel a
 * hung restore.
 *
 * There is no atomic temp-then-rename wrapper here, unlike `pg-dump.ts`'s `dumpAtomic`: a restore READS
 * the dump and WRITES into a live database, so there is no half-written artifact to fan out — the
 * truncated-backup hazard `dumpAtomic` guards against simply does not exist on the restore side.
 */
export type PgRestoreRunner = (args: {
  databaseUrl: string;
  inFile: string;
  signal?: AbortSignal;
}) => Promise<void>;

/**
 * The subprocess seam {@link pgRestoreWith} spawns through — `execFile`'s shape narrowed to what the
 * runner needs. Injected so a unit test asserts the argv the runner builds without a `pg_restore`
 * binary on PATH; the real binding ({@link realPgRestore}) is the only part left v8-ignored.
 */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv },
) => Promise<unknown>;

/**
 * Splits `databaseUrl`'s password out, returning a connection string with the password REMOVED
 * (user/host/port/dbname/query params all intact) plus the password on its own — or `undefined` when
 * the URL carried none.
 *
 * This is the ROOT fix for a password-in-argv leak: `pgRestoreWith` used to pass the WHOLE connstring
 * (password included) as a `pg_restore` argv element, and `execFile`'s argv is what a
 * rejected/non-zero-exit error's `.message` embeds VERBATIM (Node's `promisify(execFile)` behaviour)
 * — so a failing restore (bad perms, a non-fresh target, a full disk; all plausible real outcomes)
 * put the admin password straight into an error that could reach an operator's terminal or a log. The
 * same argv is also visible system-wide via `ps`/`/proc` for the process's whole lifetime.
 *
 * A libpq URI is free to omit its password and fall back to `PGPASSWORD`/`.pgpass` for it, so the
 * sanitized URI is exactly as usable as the original for `pg_restore --dbname` — nothing else needs
 * restating as a separate `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` variable, and any query parameter
 * (`?sslmode=…`) rides along unchanged. Verified against a real `postgres:18-alpine` server (the same
 * image this file's own fiscal receipt below uses): a password-less URI fails auth outright
 * (`fe_sendauth: no password supplied`) against a host rule that actually requires one, and succeeds
 * once `PGPASSWORD` is set in the CHILD PROCESS's environment — proving this is load-bearing, not
 * accidentally masked by a trust rule.
 *
 * `URL`'s `username`/`password` are percent-encoded; `decodeURIComponent` undoes that so the value
 * handed to `PGPASSWORD` is the literal password, not its URL-escaped form.
 *
 * Scope: this handles the standard `postgres://user:pass@host:port/db?query` shape restore's only
 * caller ever produces (`WAITRON_RESTORE_DATABASE_URL`, a plain libpq URL) — not a Unix-socket
 * `?host=/path` form or a bare keyword/value conninfo string. Should either of those ever reach here,
 * `new URL` throws and the restore fails loudly rather than silently mis-parsing; the sanitisation in
 * `restore-command.ts`/`bin-restore.ts` is the definitive backstop regardless of how this parse goes.
 */
function stripPassword(databaseUrl: string): { connectionArg: string; password?: string } {
  const url = new URL(databaseUrl);
  const password = url.password === "" ? undefined : decodeURIComponent(url.password);
  url.password = "";
  return { connectionArg: url.toString(), password };
}

/**
 * Builds a {@link PgRestoreRunner} that shells out to `pg_restore` through `exec`. Flag choice mirrors
 * `pg-dump.ts`'s `pgDumpShellOut`:
 *
 *  - `--no-owner` — restore every object under the INVOKING role rather than reissuing the dump's
 *    original `ALTER … OWNER TO`. A cold-recovery box (CLAUDE.md §5) restores as its own admin role and
 *    need not have recreated the source cluster's ownership graph first; the immutability triggers,
 *    REVOKE ALL and tenant-isolation policies ride along in the dump regardless of who owns the table.
 *  - `--dbname <connstring, password stripped>` — the target database. UNLIKE `pg-dump.ts`'s
 *    connstring-with-password-in-argv (a deliberate, documented tradeoff there for the dump side), the
 *    restore connstring NEVER carries the password in argv — see {@link stripPassword}'s own doc for
 *    why: this is a disaster-recovery CLI whose failure path is exactly the one an operator is most
 *    likely to see, and to paste somewhere.
 *  - the custom-format dump file, last.
 *
 * `env` is `process.env` spread with `PGPASSWORD` added, never a wholesale replacement: `execFile`'s
 * own `env` option REPLACES the child's environment rather than extending it, and `pg_restore` needs
 * this process's `PATH`/locale/etc to run at all. When the URL carries no password, `process.env` is
 * threaded through UNCHANGED (no `PGPASSWORD` fabricated, no defensive copy either).
 */
export function pgRestoreWith(exec: ExecFileFn): PgRestoreRunner {
  return async ({ databaseUrl, inFile, signal }) => {
    const { connectionArg, password } = stripPassword(databaseUrl);
    await exec("pg_restore", ["--no-owner", "--dbname", connectionArg, inFile], {
      signal,
      env: password === undefined ? process.env : { ...process.env, PGPASSWORD: password },
    });
  };
}

// The real shell-out is environment-coupled (needs a `pg_restore` binary + a live target server), so
// like `pg-dump.ts`'s `pgDumpShellOut` it is exercised by the real-container fiscal receipt in
// `pg-restore.test.ts` rather than a unit test, and stays v8-ignored. Only this execFileAsync binding
// is ignored — `pgRestoreWith`'s argv construction above IS unit-tested via an injected exec.
/* v8 ignore start */
export const realPgRestore: PgRestoreRunner = pgRestoreWith((file, args, options) =>
  execFileAsync(file, [...args], options),
);
/* v8 ignore stop */
