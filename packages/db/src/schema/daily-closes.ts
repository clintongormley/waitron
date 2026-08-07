import {
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";

/**
 * The frozen daily close (cierre Z) document, one immutable row per (tenant, node, business day).
 * Append-only and hash-chained per (tenant, node): each close carries `prev_entry_hash` (its
 * predecessor's `entry_hash`, "" for the genesis close) and its own `entry_hash`, computed over the
 * identity fields plus the `snapshot` in a later task. A deleted or tampered close breaks the chain,
 * which is exactly what the verification (Task 4) detects.
 *
 * The whole close is ONE frozen document: the per-till cash reconciliation and the VAT-exact
 * figures live inside `snapshot` (jsonb), not in a child table (design D1). That keeps the
 * immutability recipe to one table rather than two.
 *
 * `snapshot` is typed structurally here, NOT imported from `@waitron/reporting`: reporting depends
 * on this package, so the dependency cannot run the other way. `close` is the `computeDailyClose`
 * output (VAT summary, cash-up, counts) — opaque `unknown` here, reporting owns its precise type —
 * and `cashReconciliation` is the per-till/per-node cash-variance block reporting builds at close time.
 * All money is stored as `Decimal` strings, matching the rest of the schema.
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY. The FORCE ROW LEVEL SECURITY, the
 * `daily_closes_tenant_isolation` policy, the SELECT/INSERT-only grant to `app_user` (no
 * UPDATE/DELETE), and the append-only + no-truncate triggers are hand-written in the custom
 * migration (0033), exactly as packages/fiscal-verifactu's 0001_registros_inmutables.sql does for
 * `registros_facturacion`. The `inmutabilidad` guard in packages/fiscal-verifactu scans every
 * tenant_id-bearing table for ENABLE + FORCE, so a missing FORCE here fails that suite, not this
 * package's.
 */
export interface DailyCloseSnapshot {
  /** The VAT-exact `computeDailyClose` output (vat, cash, counts). Reporting owns the precise type. */
  close: unknown;
  cashReconciliation: {
    byTill: {
      tillId: string;
      /** Opening cash float in the drawer (supplied). */
      openingFloat: string;
      /** Cash removed during the day (supplied). */
      payouts: string;
      /** Physical drawer count at close (supplied). */
      countedCash: string;
      /** Cash added to the drawer over the day (from `close.cash.byTill[].cashTakings`). */
      cashTakings: string;
      /** countedCash − (openingFloat + cashTakings − payouts). */
      cashVariance: string;
    }[];
    /** Σ per-till `cashVariance`. */
    nodeVariance: string;
  };
}

export const dailyCloses = pgTable(
  "daily_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    businessDay: date("business_day").notNull(),
    // 1-based per (tenant, node), monotonic — the chain position.
    sequenceNo: integer("sequence_no").notNull(),
    // The predecessor's entry_hash ("" for the genesis close).
    prevEntryHash: text("prev_entry_hash").notNull(),
    // SHA-256(canonical(identity ‖ snapshot) ‖ prev_entry_hash), uppercase hex — set in a later task.
    entryHash: text("entry_hash").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // The counting actor (identity person id). Plain uuid, no FK: the person schema is a later slice
    // (design D3), and the close must not depend on it.
    closedBy: uuid("closed_by").notNull(),
    snapshot: jsonb("snapshot").$type<DailyCloseSnapshot>().notNull(),
  },
  (t) => [
    // Composite target so the close is tenant-consistent — a close cannot name a node of another
    // tenant — mirroring working_order_counters_node_fk. Targets nodes_tenant_id_key.
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "daily_closes_node_fk",
    }),
    // One close per business day per node.
    unique("daily_closes_business_day_key").on(t.tenantId, t.nodeId, t.businessDay),
    // Chain-position backstop: no two closes on a node share a sequence number.
    unique("daily_closes_sequence_key").on(t.tenantId, t.nodeId, t.sequenceNo),
  ],
).enableRLS();

/**
 * The mutable per-(tenant, node) chain head for {@link dailyCloses}. One row per node: `sequence_no`
 * is the last assigned close number (next close is +1) and `last_entry_hash` is the last close's
 * `entry_hash` ("" before the first). A counter, not a sequence — tenant-scoped, replicates as
 * ordinary row data (memory: replication is shared infra), and is locked FOR UPDATE + advanced under
 * the same RLS as everything else, mirroring `working_order_counters`.
 *
 * Keyed by (tenant_id, node_id), no surrogate id: there is exactly one head per node and the key is
 * the identity. MUTABLE — the head advances on every close — so it gets Part 4 of the immutability
 * recipe (FORCE RLS + tenant-isolation policy) plus a SELECT/INSERT/UPDATE grant, and NO append-only
 * trigger. The same shape `invoice_series` and `working_order_counters` already carry.
 */
export const dailyCloseChain = pgTable(
  "daily_close_chain",
  {
    tenantId: uuid("tenant_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    sequenceNo: integer("sequence_no").notNull().default(0),
    lastEntryHash: text("last_entry_hash").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.nodeId], name: "daily_close_chain_pk" }),
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "daily_close_chain_node_fk",
    }),
  ],
).enableRLS();
