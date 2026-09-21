import { rename, rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { StatementTarget } from "./append-only.js";

/** Where the copy is written while it is still a copy in progress. */
const workingName = (path: string) => `${path}.partial`;

/**
 * Copies one whole database file to `path`, through the engine rather than the filesystem.
 *
 * **Why the engine and not a file copy.** Every connection here is opened in write-ahead mode, so a
 * committed row lives in the `-wal` sidecar until something checkpoints. Measured on Node v26.7.0
 * against `node:sqlite`: after one committed insert the main file's bytes do not contain the value
 * and the `-wal` file's do, and a `copyFile` of the main file alone opens as a database answering
 * `no such table`. `VACUUM INTO` reads through the write-ahead file, so no checkpoint is needed
 * first; the case and its control are in `archive.test.ts`. The archive it writes is one
 * self-contained file — it comes out in `delete` journal mode with no sidecar of its own.
 *
 * **The path is bound, not escaped and not validated.** `CLAUDE.md` §3 asks for one of those two
 * only where a utility statement cannot be parameterised, and this one can: Drizzle emits
 * `vacuum into ?` with the path as a parameter and the engine accepts it, including a path holding
 * the quotes that make a statement built as text a syntax error (`near "s": syntax error`,
 * errcode 1). Binding is what leaves no way for a path to be read as SQL at all.
 *
 * **Temp-then-rename: the discipline that used to live beside the `pg_dump` shell-out, and now
 * lives only here.** (apps/server's pg-dump.ts and its `dumpAtomic` were deleted in the same
 * change that made this the product's archive path; the cases that proved it are `archive.test.ts`'s.)
 * The final
 * name appears only once the whole copy is written, so an interrupted archive leaves nothing a
 * later reader would take for a good one. `VACUUM INTO` refusing a target that already exists is
 * not that guarantee and does not replace it: it says nothing about a copy that died midway, and
 * it is not even a refusal in every case. Measured against three targets that already exist: a
 * database file gives `output file already exists` (errcode 1), a file whose bytes are not a
 * database gives `file is not a database` (errcode 26), and a ZERO-BYTE one is accepted and
 * written into.
 *
 * The working file is cleared before the copy as well as after a failure, because that same
 * refusal would otherwise make one interruption permanent — the leftover has bytes, so every later
 * archive to that path fails. A working file holds no finished archive by definition.
 *
 * **Not callable from inside a transaction.** `VACUUM INTO` on a connection with one open is
 * refused outright — `cannot VACUUM from within a transaction`, errcode 1, no file written — so an
 * archive cannot be taken inside `withWriteLock`, whose body runs under `begin immediate`.
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
