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

/** The `ALTER PUBLICATION … SET TABLE …` that reconciles one class's membership to the derived list.
 * Utility DDL Postgres will not bind, so every identifier is validated then double-quoted (§3); an
 * empty list is refused for the same reason `createPublicationStatement` refuses one. */
export function setPublicationTablesStatement(
  environment: "production" | "preproduction",
  cls: PublicationClass,
  tables: readonly string[],
): string {
  if (tables.length === 0) throw new Error(`the ${cls} publication has no tables`);
  const list = tables.map(quoted).join(", ");
  return `ALTER PUBLICATION ${quoted(publicationName(environment, cls))} SET TABLE ${list}`;
}

/** What `ensurePublications` did: the classes it CREATEd (absent before) and the classes it UPDATEd
 * (present with a drifted table set). A class in neither was already exactly right. */
export interface EnsurePublicationsResult {
  created: PublicationClass[];
  updated: PublicationClass[];
}

/** The publisher-side table set a publication currently names, or `null` when the publication is
 * absent. A LEFT JOIN keeps a present-but-empty publication distinguishable (one row, null table)
 * from an absent one (no rows) — though `ledger`/`state` always carry tables. Binds the name. */
async function readPublicationTables(db: Database, name: string): Promise<string[] | null> {
  const rows = await db.execute<{ tablename: string | null }>(sql`
    select pt.tablename
    from pg_publication p
    left join pg_publication_tables pt on pt.pubname = p.pubname
    where p.pubname = ${name}
  `);
  if (rows.rows.length === 0) return null;
  return rows.rows.map((r) => r.tablename).filter((t): t is string => t !== null);
}

function sameTableSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

/** Reconcile both of a node's publications to the derived table lists, as the OWNER connection:
 * absent → CREATE; present with a different table SET → `ALTER PUBLICATION … SET TABLE …`; already
 * exact → nothing. Idempotent, so an adopt/promote path that re-runs it is a no-op. The table lists
 * come from `apps/server/src/modules.ts`'s derived `LEDGER_PUBLICATION_TABLES` /
 * `STATE_PUBLICATION_TABLES` (passed in by the caller). */
export async function ensurePublications(
  db: Database,
  opts: {
    environment: "production" | "preproduction";
    ledgerTables: readonly string[];
    stateTables: readonly string[];
  },
): Promise<EnsurePublicationsResult> {
  const classes: { cls: PublicationClass; tables: readonly string[] }[] = [
    { cls: "ledger", tables: opts.ledgerTables },
    { cls: "state", tables: opts.stateTables },
  ];
  const result: EnsurePublicationsResult = { created: [], updated: [] };
  for (const { cls, tables } of classes) {
    const current = await readPublicationTables(db, publicationName(opts.environment, cls));
    if (current === null) {
      await db.execute(sql.raw(createPublicationStatement(opts.environment, cls, tables)));
      result.created.push(cls);
    } else if (!sameTableSet(current, tables)) {
      await db.execute(sql.raw(setPublicationTablesStatement(opts.environment, cls, tables)));
      result.updated.push(cls);
    }
  }
  return result;
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
