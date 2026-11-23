import { sql } from "drizzle-orm";
import { check, foreignKey, unique } from "drizzle-orm/sqlite-core";
import { id, label, newId, table, ts } from "./columns.js";
import { nodes } from "./nodes.js";

/**
 * Invoice numbering series.
 *
 * A **node** may own N series and has exactly ONE chain. Nothing here relates a
 * series to a chain: no chain column, and deliberately no unique constraint on
 * (node_id), which would silently reimpose one series per node.
 *
 * The next number is one greater than the largest number on sales in this series.
 */
export const invoiceSeries = table(
  "invoice_series",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id").notNull(),
    code: label("code").notNull(),
    purpose: label("purpose").notNull().default("standard"),
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
    check(
      "invoice_series_purpose_ck",
      sql`${t.purpose} in ('standard', 'full', 'corrective', 'full_corrective')`,
    ),
    check("invoice_series_code_ck", sql`${t.code} <> ''`),
  ],
);
