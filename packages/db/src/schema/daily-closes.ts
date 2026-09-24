import { foreignKey, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { count, day, id, json, label, newId, now, table, ts } from "./columns.js";
import { nodes } from "./nodes.js";

/**
 * The frozen daily close (cierre Z) document, one immutable row per (node, business day).
 * Append-only and hash-chained per node: each close carries `prev_entry_hash` (its
 * predecessor's `entry_hash`, "" for the genesis close) and its own `entry_hash`, computed over the
 * identity fields plus the `snapshot`. A deleted or tampered close breaks the chain.
 *
 * The whole close is ONE frozen document: the per-till cash reconciliation and the VAT-exact
 * figures live inside `snapshot`, not in a child table. That keeps the immutability recipe to one
 * table rather than two.
 *
 * `snapshot` is typed structurally here, NOT imported from `@waitron/reporting`: reporting depends
 * on this package, so the dependency cannot run the other way. `close` is the `computeDailyClose`
 * output (VAT summary, cash-up, counts) — opaque `unknown` here, reporting owns its precise type —
 * and `cashReconciliation` is the per-till/per-node cash-variance block reporting builds at close time.
 * The money inside `snapshot` is `Decimal` strings, NOT the whole cents a money COLUMN
 * holds (`money()` in columns.ts): the document is above the cents boundary, so reporting
 * writes and reads it in decimals with no conversion.
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

export const dailyCloses = table(
  "daily_closes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id").notNull(),
    businessDay: day("business_day").notNull(),
    // 1-based per node, monotonic — the chain position.
    sequenceNo: count("sequence_no").notNull(),
    prevEntryHash: label("prev_entry_hash").notNull(),
    // Uppercase hex SHA-256: `computeCloseEntryHash` (`packages/reporting/src/daily-close-hash.ts`).
    entryHash: label("entry_hash").notNull(),
    closedAt: ts("closed_at").notNull().$defaultFn(now),
    // The counting actor (identity person id). Plain uuid, no FK: `persons` is in
    // @waitron/identity's migration set, not the core one.
    closedBy: id("closed_by").notNull(),
    snapshot: json<DailyCloseSnapshot>("snapshot").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "daily_closes_node_fk",
    }),
    unique("daily_closes_business_day_key").on(t.nodeId, t.businessDay),
    // Chain-position backstop: no two closes on a node share a sequence number.
    unique("daily_closes_sequence_key").on(t.nodeId, t.sequenceNo),
  ],
);

export const dailyCloseChain = table(
  "daily_close_chain",
  {
    nodeId: id("node_id").notNull(),
    sequenceNo: count("sequence_no").notNull().default(0),
    lastEntryHash: label("last_entry_hash").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId], name: "daily_close_chain_pk" }),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "daily_close_chain_node_fk",
    }),
  ],
);
