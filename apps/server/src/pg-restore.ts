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
  options: { signal?: AbortSignal },
) => Promise<unknown>;

/**
 * Builds a {@link PgRestoreRunner} that shells out to `pg_restore` through `exec`. The argv is the
 * point, and mirrors `pg-dump.ts`'s `pgDumpShellOut`:
 *
 *  - `--no-owner` — restore every object under the INVOKING role rather than reissuing the dump's
 *    original `ALTER … OWNER TO`. A cold-recovery box (CLAUDE.md §5) restores as its own admin role and
 *    need not have recreated the source cluster's ownership graph first; the immutability triggers,
 *    REVOKE ALL and tenant-isolation policies ride along in the dump regardless of who owns the table.
 *  - `--dbname <connstring>` — the target database, a libpq connstring (password included; same
 *    single-operator-appliance tradeoff `pgDumpShellOut` documents for the dump connstring).
 *  - the custom-format dump file, last.
 */
export function pgRestoreWith(exec: ExecFileFn): PgRestoreRunner {
  return async ({ databaseUrl, inFile, signal }) => {
    await exec("pg_restore", ["--no-owner", "--dbname", databaseUrl, inFile], { signal });
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
