// Side-effect import: registers the `close.*` codes this file throws (./errors.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, addDecimal, compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import type { Decimal, NodeId, TillId } from "@waitron/shared";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { UNIQUE_VIOLATION, dailyCloseChain, dailyCloses, refusalOn } from "@waitron/db";
import { computeDailyClose } from "./daily-close.js";
import { computeCloseEntryHash } from "./daily-close-hash.js";
import type {
  CashCountInput,
  DailyCloseRecord,
  DailyCloseSnapshot,
  RecordDailyCloseInput,
  TillReconciliation,
} from "./close-types.js";
import type { DailyClose } from "./types.js";

/**
 * Records one frozen daily close (cierre Z) inside the caller's transaction: reads the node's chain
 * head, computes the close, reconciles the physical cash counts against it per till, and appends one
 * hash-chained `daily_closes` row, advancing the head in the same transaction.
 *
 * Two closers cannot read the same head, because one write transaction runs on the venue file at a
 * time (`assertExtraListForWrite` in `packages/catalogue/src/extras.ts` carries the receipt). There
 * is no retry: a sequence collision here is a bug, not a race.
 *
 * The immutability is the table's, not this function's: `daily_closes` is declared `appendOnly` in
 * `packages/db/src/classification.ts`.
 */
export async function recordDailyClose(
  tx: Transaction,
  input: RecordDailyCloseInput,
): Promise<DailyCloseRecord> {
  const counts = validateCashCounts(input.cashCounts);

  const head = await readChainHead(tx, input.nodeId);

  const close = await computeDailyClose(tx, {
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    timeZone: input.timeZone,
    dayCutover: input.dayCutover,
  });

  const snapshot = reconcile(close, counts);

  const sequenceNo = head.sequenceNo + 1;
  const prevEntryHash = head.lastEntryHash;
  // Whole seconds, because that is all the hash commits to (`toEpochSeconds`); the row stores the
  // same instant.
  const closedAt = truncateToWholeSecond(new Date());
  const entryHash = computeCloseEntryHash(
    {
      nodeId: input.nodeId,
      businessDay: input.businessDay,
      sequenceNo,
      closedAt,
      closedBy: input.closedBy,
      snapshot,
    },
    prevEntryHash,
  );

  const id = await insertClose(tx, {
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    sequenceNo,
    prevEntryHash,
    entryHash,
    closedAt,
    closedBy: input.closedBy,
    snapshot,
  });

  // In the same transaction as the close, so the head always names the true tip, which
  // verifyDailyCloseChain's tail check relies on.
  await tx
    .update(dailyCloseChain)
    .set({ sequenceNo, lastEntryHash: entryHash })
    .where(eq(dailyCloseChain.nodeId, input.nodeId));

  return {
    id,
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    sequenceNo,
    prevEntryHash,
    entryHash,
    closedAt,
    closedBy: input.closedBy,
    snapshot,
  };
}

/**
 * The key a second close of the same day collides on, `daily_closes_business_day_key`. Its sibling
 * `daily_closes_sequence_key` differs in the second column alone.
 */
const BUSINESS_DAY_KEY: ConstraintTarget = {
  table: "daily_closes",
  columns: ["node_id", "business_day"],
};

const ZERO = decimal("0.00");

function truncateToWholeSecond(when: Date): Date {
  return new Date(Math.floor(when.getTime() / 1000) * 1000);
}

/** One supplied count, its money already parsed and proven non-negative. */
interface ParsedCount {
  tillId: TillId;
  openingFloat: Decimal;
  payouts: Decimal;
  countedCash: Decimal;
}

/** Parses a supplied money figure and rejects a negative or non-numeric one: an operator's cash
 * count arrives as untrusted text. `reason` is a stable English discriminator, never a user
 * sentence. */
function requireNonNegativeMoney(tillId: TillId, field: string, raw: string): Decimal {
  let value: Decimal;
  try {
    value = decimal(raw);
  } catch {
    throw new AppError("close.invalid_cash_input", { tillId, reason: `${field}_not_a_number` });
  }
  if (compareDecimal(value, ZERO) < 0) {
    throw new AppError("close.invalid_cash_input", { tillId, reason: `${field}_negative` });
  }
  return value;
}

/** Validates the supplied counts in isolation (before any DB work): each till counted once, every
 * figure a non-negative money literal. The cross-checks that need the computed close — that every
 * cash-taking till is counted and no count names an unknown till — happen in {@link reconcile}. */
function validateCashCounts(cashCounts: readonly CashCountInput[]): ParsedCount[] {
  const seen = new Set<string>();
  const parsed: ParsedCount[] = [];
  for (const c of cashCounts) {
    if (seen.has(c.tillId)) {
      throw new AppError("close.invalid_cash_input", {
        tillId: c.tillId,
        reason: "duplicate_till",
      });
    }
    seen.add(c.tillId);
    parsed.push({
      tillId: c.tillId,
      openingFloat: requireNonNegativeMoney(c.tillId, "opening_float", c.openingFloat),
      payouts: requireNonNegativeMoney(c.tillId, "payouts", c.payouts),
      countedCash: requireNonNegativeMoney(c.tillId, "counted_cash", c.countedCash),
    });
  }
  return parsed;
}

/**
 * Reconciles the physical counts against the close's per-till cash takings and assembles the frozen
 * snapshot. `cashVariance = countedCash − (openingFloat + cashTakings − payouts)`: positive is an
 * overage, negative a shortage. `cashTakings` is copied from `close.cash.byTill[].cashTakings`,
 * never re-derived. Two faults are caught here because they need the computed close:
 * a till whose sales added cash (`cashTakings > 0`) that was left uncounted, and a count for a till
 * with no tender activity in the close at all.
 */
function reconcile(close: DailyClose, counts: readonly ParsedCount[]): DailyCloseSnapshot {
  const takingsByTill = new Map<string, Decimal>(
    close.cash.byTill.map((t) => [t.tillId, t.cashTakings]),
  );
  const countedTills = new Set<string>(counts.map((c) => c.tillId));

  // Every till whose sales added cash to a drawer must be counted, or the reconciliation is blind to
  // real money. A card-only till (cashTakings 0.00) is not forced — nothing to reconcile.
  for (const t of close.cash.byTill) {
    if (compareDecimal(t.cashTakings, ZERO) > 0 && !countedTills.has(t.tillId)) {
      throw new AppError("close.invalid_cash_input", {
        tillId: t.tillId,
        reason: "uncounted_cash_till",
      });
    }
  }

  const byTill: TillReconciliation[] = counts.map((c) => {
    const cashTakings = takingsByTill.get(c.tillId);
    if (cashTakings === undefined) {
      // A count for a till the close never saw — nothing to reconcile it against.
      throw new AppError("close.invalid_cash_input", { tillId: c.tillId, reason: "unknown_till" });
    }
    const expected = subtractDecimal(addDecimal(c.openingFloat, cashTakings), c.payouts);
    return {
      tillId: c.tillId,
      openingFloat: c.openingFloat,
      payouts: c.payouts,
      countedCash: c.countedCash,
      cashTakings,
      cashVariance: subtractDecimal(c.countedCash, expected),
    };
  });

  // Code-unit order, as the hash sorts it, so the frozen document reads the same however the counts
  // were enumerated.
  byTill.sort((a, b) => Number(a.tillId > b.tillId) - Number(a.tillId < b.tillId));

  const nodeVariance = byTill.reduce<Decimal>((sum, r) => addDecimal(sum, r.cashVariance), ZERO);
  return { close, cashReconciliation: { byTill, nodeVariance } };
}

interface ChainHead {
  sequenceNo: number;
  lastEntryHash: string;
}

/** This node's chain head, or `undefined` when it has none yet. */
async function selectHead(tx: Transaction, nodeId: NodeId): Promise<ChainHead | undefined> {
  const [row] = await tx
    .select({
      sequenceNo: dailyCloseChain.sequenceNo,
      lastEntryHash: dailyCloseChain.lastEntryHash,
    })
    .from(dailyCloseChain)
    .where(eq(dailyCloseChain.nodeId, nodeId));
  return row;
}

/**
 * This node's chain head, creating it if it has none yet. The insert is followed by a re-select
 * rather than a `returning`, which gives nothing back for a conflicting row.
 */
async function readChainHead(tx: Transaction, nodeId: NodeId): Promise<ChainHead> {
  const existing = await selectHead(tx, nodeId);
  if (existing !== undefined) return existing;

  await tx
    .insert(dailyCloseChain)
    .values({ nodeId })
    .onConflictDoNothing({ target: [dailyCloseChain.nodeId] });

  const created = await selectHead(tx, nodeId);
  /* v8 ignore start */
  if (created === undefined) {
    // Unreachable: the insert above writes a fresh row, or the conflict arm finds one already
    // there; the re-select then reads whichever exists.
    throw new Error("daily_close_chain: head row missing immediately after insert-on-conflict");
  }
  /* v8 ignore stop */
  return created;
}

interface CloseRow {
  nodeId: NodeId;
  businessDay: string;
  sequenceNo: number;
  prevEntryHash: string;
  entryHash: string;
  closedAt: Date;
  closedBy: string;
  snapshot: DailyCloseSnapshot;
}

/**
 * Appends the row in a savepoint (a nested `tx.transaction`). Its body is one insert, which SQLite
 * backs out by itself when refused, leaving the transaction usable, so today the savepoint confines
 * nothing (`docs/developers/conventions-data.md` has the probe). Only a
 * `daily_closes_business_day_key` collision — a second close of the same day — becomes
 * `close.already_closed`; anything else, a `daily_closes_sequence_key` collision included,
 * propagates raw, because reporting it as "already closed" would hide a single-writer bug for a day
 * that is NOT closed.
 */
async function insertClose(tx: Transaction, row: CloseRow): Promise<string> {
  try {
    return await tx.transaction(async (sp) => {
      const [inserted] = await sp.insert(dailyCloses).values(row).returning({ id: dailyCloses.id });
      /* v8 ignore start */
      if (inserted === undefined) {
        throw new Error("daily_closes: insert returned no row");
      }
      /* v8 ignore stop */
      return inserted.id;
    });
  } catch (error) {
    if (isBusinessDayConflict(error)) {
      throw new AppError("close.already_closed", { businessDay: row.businessDay });
    }
    throw error;
  }
}

/**
 * Is this (or anything it wraps) a unique violation on the business-day key — a second close of the
 * same (node, business day)? The unique code alone would also match `daily_closes_sequence_key`.
 *
 * Exported for the crafted-error unit tests, not from the barrel.
 */
export function isBusinessDayConflict(error: unknown): boolean {
  return refusalOn(error, UNIQUE_VIOLATION, BUSINESS_DAY_KEY);
}
