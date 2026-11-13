import { withTransaction, type Database } from "@waitron/db";
import type { FiscalDeclarationsSeat } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { readDeclarationFolder, type KeptDeclarations } from "./declaration-pages.js";
import type { Logger } from "./logger.js";

/** Keeps the declaration of the release this box runs; a failure is logged and never stops a start. */
export async function keepRunningDeclaration(deps: {
  root: string;
  seat: FiscalDeclarationsSeat;
  db: Database;
  now: () => Date;
  log: Logger;
}): Promise<void> {
  const { seat } = deps;
  try {
    const folder = await readDeclarationFolder(deps.root);
    if (folder.kind !== "release") return;
    const entry = { version: folder.version, text: folder.text, at: deps.now() };
    await withTransaction(deps.db, (tx) => seat.keep(tx, entry));
  } catch (error) {
    deps.log("warn", "declaration.keep_failed", { errorCode: codeOf(error) });
  }
}

/** Plain reads on `db`, not `withWriteLock` turns: a sign-in-free page must not queue in the lock
 * sales use, and a plain read neither waits on it nor drains the change list. Shown by
 * `keep-declaration.test.ts`'s "answers while another caller holds the write lock, with committed
 * rows only" and "reads with a change waiting in the change list and leaves it waiting". */
export function keptDeclarationsReader(
  db: Database,
  seat: FiscalDeclarationsSeat,
): KeptDeclarations {
  return {
    versions: () => seat.versions(db),
    text: (version) => seat.text(db, version),
  };
}
