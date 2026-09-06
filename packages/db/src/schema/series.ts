import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";
import { tenants } from "./tenants.js";

/**
 * Invoice numbering series.
 *
 * A **node** may own N series and has exactly ONE chain (findings §1; the
 * node-id rekey, 2026-08-03, moved this from till to node — the SIF that owns
 * the chain is the node, #33). Nothing here relates a series to a chain: no
 * chain column, and deliberately no unique constraint on (tenant_id, node_id),
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
 * UNIQUE (tenant_id, series_id, invoice_number), not here.
 */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The `() => tenants.id` reference thunk below is stored by drizzle-orm and
    // called only when something resolves foreign key metadata (drizzle-kit's
    // own generate/introspection, run in a separate CLI process) — never by
    // ordinary query building, since Postgres enforces the constraint
    // server-side. No test in this suite exercises that resolution path, and —
    // verified live — passing the second `{ onDelete: ... }` argument is what
    // makes v8 track each thunk as its own never-invoked function; the
    // identical one-argument `.references(() => tenants.id)` calls in
    // ./tenants.ts are not tracked as functions at all. `v8 ignore` here,
    // rather than dropping the explicit `onDelete`, keeps the FK behaviour
    // self-documenting.
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The node that owns this series and its chain (node-id rekey, 2026-08-03:
    // was `till_id`). Bare column: the FK is the tenant-consistent COMPOSITE
    // (tenant_id, node_id) → nodes(tenant_id, id) declared in extraConfig below
    // (mirroring the `sales`/`working_orders`/`payments` node FKs). NOT NULL, so
    // the composite ALWAYS checks — a series can never point at a node belonging
    // to another tenant. No `.references()` here, so nothing for v8 to track.
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
    unique("invoice_series_node_code_key").on(t.tenantId, t.nodeId, t.code),
    // Composite target for tenant-consistent foreign keys from `sales`: a
    // child row cannot point at a parent belonging to another tenant.
    unique("invoice_series_tenant_id_key").on(t.tenantId, t.id),
    index("invoice_series_tenant_idx").on(t.tenantId),
    // Tenant-consistent composite FK to the owning node (Copilot #54 follow-through): a series
    // cannot point at a node belonging to another tenant, independently of whether RLS is in force
    // on this connection. node_id is NOT NULL, so unlike the nullable node FKs on
    // `working_orders`/`payments` this one ALWAYS checks — the strongest form, and fiscally
    // load-bearing (the series↔node guard reads `node_id`). Mirrors `sales_node_fk`.
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "invoice_series_node_fk",
    }),
    // A CHECK rather than a pgEnum, deliberately: the permitted set depends on
    // asesor Q5(b), which is unverified. Widening a CHECK is one line of
    // migration; widening an enum needs ALTER TYPE.
    check("invoice_series_purpose_ck", sql`${t.purpose} in ('standard', 'rectificative')`),
    check("invoice_series_next_number_ck", sql`${t.nextNumber} >= 1`),
    check("invoice_series_code_ck", sql`${t.code} <> ''`),
  ],
).enableRLS();
