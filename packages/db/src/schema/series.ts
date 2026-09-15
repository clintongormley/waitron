import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";

/**
 * Invoice numbering series.
 *
 * A **node** may own N series and has exactly ONE chain (findings §1; the
 * node-id rekey, 2026-08-03, moved this from till to node — the SIF that owns
 * the chain is the node, #33). Nothing here relates a series to a chain: no
 * chain column, and deliberately no unique constraint on (node_id),
 * which would silently reimpose one series per node.
 *
 * `next_number` is the live counter and the single source of truth: a plain
 * integer column, advanced in place by the allocating UPDATE under the row
 * lock that statement takes. There is no sequence and no second copy of the
 * value to drift out of step with it.
 *
 * Allocation is transactional, so a rollback returns the number and no gap
 * appears. That is correct — the regulation requires strictly-increasing and
 * never-reused numbering and permits gaps without requiring them. "Never
 * reused once used" is enforced on `sales` by
 * UNIQUE (series_id, invoice_number), not here.
 */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The node that owns this series and its chain (node-id rekey, 2026-08-03:
    // was `till_id`). Bare column: the (node_id) → nodes(id) FK is declared in
    // extraConfig below (mirroring the `sales`/`working_orders`/`payments` node
    // FKs).
    nodeId: uuid("node_id").notNull(),
    code: text("code").notNull(),
    purpose: text("purpose").notNull().default("standard"),
    nextNumber: integer("next_number").notNull().default(1),
    // Set when the series stops numbering: a cold restore retires every live series of the node and
    // opens fresh ones (spec 2026-09-06-module-sp3d §3.2). A retired series stays for history — sales
    // reference it by id — and the write paths refuse to number from it.
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("invoice_series_node_code_key").on(t.nodeId, t.code),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "invoice_series_node_fk",
    }),
    // A CHECK rather than a pgEnum, deliberately: the permitted set depends on
    // asesor Q5(b), which is unverified. Widening a CHECK is one line of
    // migration; widening an enum needs ALTER TYPE.
    check("invoice_series_purpose_ck", sql`${t.purpose} in ('standard', 'rectificative')`),
    check("invoice_series_next_number_ck", sql`${t.nextNumber} >= 1`),
    check("invoice_series_code_ck", sql`${t.code} <> ''`),
  ],
);
