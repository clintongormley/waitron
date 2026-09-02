// The static per-table apply SQL for the commercial-lane outbox. Each statement is a pure function of
// its enrolled table (registry.ts) and the live Drizzle schema — never a captured row's contents — so
// apply.ts builds each apply statement once into its module-level dispatch map and reuses it per row,
// rather than rebuilding (and re-deriving the watermark column list) for every row of a batch.
// Table names are literals drawn from the fixed ENROLLED registry; column names are read
// off the compile-time Drizzle table objects. So no identifier is runtime-derived and the CLAUDE.md
// §3 identifier-escaping question does not arise (apply-sql.test.ts proves it): the whole row_image
// binds as the single `$1` via jsonb_populate_record, exactly the shape the container gates validated
// (docs/superpowers/specs/2026-08-06-sync-container-gates-findings.md).

import { getTableColumns, type Table } from "drizzle-orm";
import {
  catalogues,
  categories,
  diningTables,
  floorZones,
  products,
  saleLines,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  sales,
  tableServiceStatuses,
  tenders,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
// Deep import into @waitron/payments: its schema table objects are exported from
// ./schema/index.js, not the package barrel (which never re-exports schema tables — see the comment
// atop packages/payments/src/schema/index.ts). @waitron/payments declares no `exports` map, so a
// subpath import resolves, the same way test files reach its ./testing/fake-provider.js.
import { paymentPolicy, paymentRefunds, payments } from "@waitron/payments/src/schema/index.js";
// Deep import into @waitron/identity: its schema table objects are exported from ./schema/index.js.
// The package declares no `exports` map, so a subpath import resolves (same as @waitron/payments's
// schema, above). Deliberately NOT the package barrel — that loads identity's auth runtime
// (@simplewebauthn/server, login, passkey) the apply path never uses.
import { persons, webauthnCredentials } from "@waitron/identity/src/schema/index.js";
import type { EnrolledTable } from "./registry.js";

/**
 * The Drizzle schema object for every enrolled table, keyed by physical table name. The column list
 * for a watermark upsert's `DO UPDATE SET` is derived from these at build time via
 * `getTableColumns`, so it can never drift from the schema the way a hand-maintained array would
 * (CLAUDE.md §2). Covers all nineteen so apply-sql.test.ts can assert completeness against ENROLLED.
 */
export const SYNC_SCHEMA_TABLES: Record<string, Table> = {
  sales,
  sale_lines: saleLines,
  tenders,
  sale_settlements: saleSettlements,
  sale_substitutions: saleSubstitutions,
  sale_voids: saleVoids,
  payment_refunds: paymentRefunds,
  catalogues,
  categories,
  products,
  payments,
  payment_policy: paymentPolicy,
  working_orders: workingOrders,
  working_order_lines: workingOrderLines,
  dining_tables: diningTables,
  floor_zones: floorZones,
  table_service_statuses: tableServiceStatuses,
  persons,
  webauthn_credentials: webauthnCredentials,
};

/** The physical DB-column names of an enrolled table, in schema-definition order. */
function columnNamesFor(table: string): string[] {
  const t = SYNC_SCHEMA_TABLES[table];
  if (t === undefined) {
    throw new Error(`no drizzle schema object registered for enrolled table "${table}"`);
  }
  return Object.values(getTableColumns(t)).map((c) => c.name);
}

/**
 * The idempotent upsert/insert statement for one enrolled table:
 *   - insert-only: `… ON CONFLICT (<key>) DO NOTHING` (a re-delivery is a no-op even with different
 *     bytes — the append-only row is never overwritten).
 *   - watermark-upsert WITH a watermark column: `… DO UPDATE SET <cols> WHERE excluded.<wm> > t.<wm>`
 *     so an older/equal image is a no-op and the mirror never regresses (spec §3).
 *   - watermark-upsert with NO watermark column (Group C): the same DO UPDATE SET, UNCONDITIONAL —
 *     non-regression rests on the seq cursor, not a row-level guard (spec §3).
 * `<cols>` is every column except the conflict key. The whole row binds as `$1`.
 */
export function applyStatementFor(entry: EnrolledTable): string {
  const t = entry.table;
  const key = entry.conflictKey.join(", ");
  const populate = `insert into ${t} select * from jsonb_populate_record(null::${t}, $1)`;
  if (entry.mode === "insert-only") {
    return `${populate} on conflict (${key}) do nothing`;
  }
  const setCols = columnNamesFor(t).filter((c) => !entry.conflictKey.includes(c));
  const setClause = setCols.map((c) => `${c} = excluded.${c}`).join(", ");
  const upsert = `${populate} on conflict (${key}) do update set ${setClause}`;
  if (entry.watermarkColumn === null) {
    return upsert;
  }
  const wm = entry.watermarkColumn;
  return `${upsert} where excluded.${wm} > ${t}.${wm}`;
}

/**
 * The idempotent delete statement for a Group C (DELETE-capable) table: `DELETE … WHERE <key> =
 * ($1->>'<key>')::uuid`, a 0-row no-op when the row is already absent (spec §3). Refuses a table
 * that captures no delete — Group A/B have no delete to apply, so asking for one is a programming
 * error, not a silent empty statement. Group C conflict keys are single-column `id` (spec §2).
 */
export function deleteStatementFor(entry: EnrolledTable): string {
  if (!entry.captureOps.includes("delete")) {
    throw new Error(
      `table "${entry.table}" captures no delete op; deleteStatementFor is for Group C (DELETE-capable) tables only`,
    );
  }
  const key = entry.conflictKey[0];
  return `delete from ${entry.table} where ${key} = ($1->>'${key}')::uuid`;
}
