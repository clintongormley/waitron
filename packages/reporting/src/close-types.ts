import type { Decimal, NodeId, TillId } from "@waitron/shared";
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
 * The frozen close document stored in `daily_closes.snapshot` and covered by the close's
 * `entry_hash`. The precise type: `@waitron/db`'s structural `DailyCloseSnapshot` carries `close` as
 * `unknown`, because db cannot import reporting. Kept assignable to that interface so a close
 * inserts without a cast.
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

/**
 * One till's supplied cash count — the raw operator input `recordDailyClose` reconciles. The money
 * fields are plain `string`, not `Decimal`, because nothing has validated them yet;
 * `recordDailyClose` refuses a negative or non-numeric one with `close.invalid_cash_input`.
 */
export interface CashCountInput {
  tillId: TillId;
  openingFloat: string;
  payouts: string;
  countedCash: string;
}

/**
 * The input to `recordDailyClose`: the same identity `computeDailyClose` takes, plus the counting
 * actor and the per-till physical cash counts. `closedBy` is an identity person id.
 */
export interface RecordDailyCloseInput {
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
  nodeId: NodeId;
  businessDay: string;
  /** 1-based chain position within the node's chain. */
  sequenceNo: number;
  prevEntryHash: string;
  entryHash: string;
  closedAt: Date;
  closedBy: string;
  snapshot: DailyCloseSnapshot;
}
