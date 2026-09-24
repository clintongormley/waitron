import { rename, rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { StatementTarget } from "./append-only.js";

/** Where the copy is written while it is still a copy in progress. */
const workingName = (path: string) => `${path}.partial`;

/**
 * Copies one whole database file to `path`, through the engine rather than the filesystem: in
 * write-ahead mode a committed row lives in the `-wal` sidecar until something checkpoints, and
 * `VACUUM INTO` reads through it into one self-contained file. The path is bound, so it is never
 * read as SQL.
 *
 * The final name appears only once the whole copy is written, so an interrupted archive leaves
 * nothing a later reader would take for a good one. The working file is cleared before the copy as
 * well as after a failure, because `VACUUM INTO` refuses a target that already holds bytes, so a
 * leftover would fail every later archive to that path.
 *
 * **Not callable from inside a transaction.** `VACUUM INTO` on a connection with one open is
 * refused — `cannot VACUUM from within a transaction` — so an archive cannot be taken inside
 * `withWriteLock`. From OUTSIDE a running body, while another one holds a transaction open, the
 * store routes the statement to the read connection, where the copy holds the committed state.
 */
export async function archiveTo(target: StatementTarget, path: string): Promise<void> {
  const working = workingName(path);
  await rm(working, { force: true });
  try {
    target.run(sql`vacuum into ${working}`);
    await rename(working, path);
  } catch (error) {
    await rm(working, { force: true });
    throw error;
  }
}
