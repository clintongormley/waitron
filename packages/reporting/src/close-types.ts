import type { Decimal, NodeId, TenantId, TillId } from "@waitron/shared";
import type { DailyClose } from "./types.js";

/**
 * The per-till cash reconciliation for one till at close time. All money is `Decimal` strings.
 *
 * `cashVariance = countedCash − (openingFloat + cashTakings − payouts)`: positive is an overage
 * (more cash in the drawer than the takings explain), negative a shortage. `cashTakings` is the
 * cash the day's sales added to the drawer — copied from `close.cash.byTill[].cashTakings`, never a
 * fresh derivation — so the variance measures the physical count against the fiscal record.
 */
export interface TillReconciliation {
  tillId: TillId;
  /** Opening cash float in the drawer (supplied by the counting operator). */
  openingFloat: Decimal;
  /** Cash removed from the drawer during the day (supplied). */
  payouts: Decimal;
  /** Physical drawer count at close (supplied). */
  countedCash: Decimal;
  /** Cash the day's sales added to the drawer, from `close.cash.byTill[].cashTakings`. */
  cashTakings: Decimal;
  /** `countedCash − (openingFloat + cashTakings − payouts)`. */
  cashVariance: Decimal;
}

/**
 * The frozen close document stored verbatim in `daily_closes.snapshot` (jsonb) and covered by the
 * close's `entry_hash`. This is the PRECISE snapshot: `close` is the exact `computeDailyClose`
 * output, not the opaque `unknown` the db package's structural `DailyCloseSnapshot` carries (db
 * cannot import reporting — reporting depends on db, not the reverse). Kept structurally compatible
 * with that db interface so Task 3 can insert without a cast: every `Decimal` here is a `string`
 * there, and `DailyClose` is assignable to `unknown`.
 */
export interface DailyCloseSnapshot {
  /** The VAT-exact `computeDailyClose` output (vat summary, cash-up, counts). */
  close: DailyClose;
  cashReconciliation: {
    byTill: TillReconciliation[];
    /** Σ per-till `cashVariance` across the node. */
    nodeVariance: string;
  };
}

/** One till's supplied cash count — the raw operator input `recordDailyClose` reconciles. */
export interface CashCountInput {
  tillId: TillId;
  openingFloat: Decimal;
  payouts: Decimal;
  countedCash: Decimal;
}

/**
 * The input to `recordDailyClose` (Task 3): the same identity `computeDailyClose` takes, plus the
 * counting actor and the per-till physical cash counts. `closedBy` is an identity person id (plain
 * uuid string — the person schema is a later slice, and the close must not depend on it).
 */
export interface RecordDailyCloseInput {
  tenantId: TenantId;
  nodeId: NodeId;
  /** Local calendar date of the business day, "YYYY-MM-DD". */
  businessDay: string;
  /** IANA timezone, e.g. "Europe/Madrid". Required; never defaulted to UTC. */
  timeZone: string;
  /** "HH:MM" time-of-day in `timeZone` at which the business day starts, e.g. "05:00". */
  dayCutover: string;
  /** The counting actor (identity person id). */
  closedBy: string;
  cashCounts: CashCountInput[];
}

/**
 * A persisted close, as returned by `recordDailyClose` and read back by `verifyDailyCloseChain`.
 * Mirrors the `daily_closes` row with the precise snapshot type. `prevEntryHash` is "" for the
 * genesis close.
 */
export interface DailyCloseRecord {
  id: string;
  tenantId: TenantId;
  nodeId: NodeId;
  businessDay: string;
  /** 1-based chain position within the (tenant, node) chain. */
  sequenceNo: number;
  prevEntryHash: string;
  entryHash: string;
  closedAt: Date;
  closedBy: string;
  snapshot: DailyCloseSnapshot;
}
