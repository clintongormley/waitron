import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { quoted } from "./identifier.js";

/** The two publications a node holds (swap spec §2.1): `ledger` (what happened, drained back) and
 * `state` (configuration + live service, copied only). `local` tables are in neither. */
export type PublicationClass = "ledger" | "state";

/** `waitron_<environment>_<ledger|state>` — the name carries the environment, half of the isolation
 * in spec §2.4 (a production subscriber naming `waitron_production_*` finds nothing on a
 * preproduction publisher; the copy simply never happens — Task 7 proves this). */
export function publicationName(
  environment: "production" | "preproduction",
  cls: PublicationClass,
): string {
  return `waitron_${environment}_${cls}`;
}

/** The `CREATE PUBLICATION … FOR TABLE …` for one class, from the derived table list. Utility DDL
 * Postgres will not bind, so every identifier is validated then double-quoted (CLAUDE.md §3). An
 * empty list is refused: `ledger` and `state` always carry tables. */
export function createPublicationStatement(
  environment: "production" | "preproduction",
  cls: PublicationClass,
  tables: readonly string[],
): string {
  if (tables.length === 0) throw new Error(`the ${cls} publication has no tables`);
  const list = tables.map(quoted).join(", ");
  return `CREATE PUBLICATION ${quoted(publicationName(environment, cls))} FOR TABLE ${list}`;
}

/** Create both of a node's publications as the OWNER connection (the migrator owns every table, so a
 * non-superuser owner can `CREATE PUBLICATION … FOR TABLE <list>`; `FOR ALL TABLES` is superuser-only
 * — prototype finding 1). The table lists come from `apps/server/src/modules.ts`'s derived
 * `LEDGER_PUBLICATION_TABLES` / `STATE_PUBLICATION_TABLES` (passed in by the step-4 caller). */
export async function createPublications(
  db: Database,
  opts: {
    environment: "production" | "preproduction";
    ledgerTables: readonly string[];
    stateTables: readonly string[];
  },
): Promise<void> {
  await db.execute(
    sql.raw(createPublicationStatement(opts.environment, "ledger", opts.ledgerTables)),
  );
  await db.execute(
    sql.raw(createPublicationStatement(opts.environment, "state", opts.stateTables)),
  );
}
