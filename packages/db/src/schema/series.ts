import { sql } from "drizzle-orm";
import { check, foreignKey, unique } from "drizzle-orm/sqlite-core";
import { count, id, label, newId, table, ts } from "./columns.js";
import { nodes } from "./nodes.js";

/**
 * Invoice numbering series.
 *
 * A **node** may own N series and has exactly ONE chain. Nothing here relates a
 * series to a chain: no chain column, and deliberately no unique constraint on
 * (node_id), which would silently reimpose one series per node.
 *
 * `next_number` is the live counter and the single source of truth, advanced
 * in place by the allocating UPDATE (`../allocate-number.ts`). There is no
 * sequence and no second copy of the value to drift out of step with it.
 *
 * Allocation is transactional, so a rollback returns the number and no gap
 * appears. That is correct — the regulation requires strictly-increasing and
 * never-reused numbering and permits gaps without requiring them. "Never
 * reused once used" is enforced on `sales` by
 * UNIQUE (series_id, invoice_number), not here.
 */
export const invoiceSeries = table(
  "invoice_series",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id").notNull(),
    code: label("code").notNull(),
    purpose: label("purpose").notNull().default("standard"),
    nextNumber: count("next_number").notNull().default(1),
    // Set when the series stops numbering: a cold restore retires every live series of the node and
    // opens fresh ones. A retired series stays for history — sales reference it by id — and the
    // write paths refuse to number from it.
    retiredAt: ts("retired_at"),
  },
  (t) => [
    unique("invoice_series_node_code_key").on(t.nodeId, t.code),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "invoice_series_node_fk",
    }),
    // A hand-written CHECK rather than the `enumType`/`enumCheck` pair, deliberately: the permitted
    // set depends on asesor Q5(b), which is unverified, and a set still being decided is not a
    // vocabulary.
    check("invoice_series_purpose_ck", sql`${t.purpose} in ('standard', 'rectificative')`),
    check("invoice_series_next_number_ck", sql`${t.nextNumber} >= 1`),
    check("invoice_series_code_ck", sql`${t.code} <> ''`),
  ],
);
