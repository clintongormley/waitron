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

export function keptDeclarationsReader(
  db: Database,
  seat: FiscalDeclarationsSeat,
): KeptDeclarations {
  return {
    versions: () => seat.versions(db),
    text: (version) => seat.text(db, version),
  };
}
