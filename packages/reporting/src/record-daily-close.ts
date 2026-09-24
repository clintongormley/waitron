// Side-effect only: registers this package's `close.*` codes on the shared `ErrorParams` registry by
// declaration merging. See ./errors.ts for the codes and the reasoning. THIS direct `import
// "./errors.js"` is what loads the augmentation (CLAUDE.md §3: every file that throws a code imports
// its registry directly) — not ./errors.reachability.test.ts, which per CLAUDE.md §4 is only a smoke
// test that the codes construct and does NOT prove barrel reachability.
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
 * The single active writer's path for one frozen daily close (cierre Z, design §"The close
 * operation"), run inside the caller's transaction. It reads the node's chain head, computes
 * the VAT-exact close (8a), reconciles the physical cash counts against it per till, and appends one
 * immutable, hash-chained `daily_closes` row — advancing the head in the same transaction.
 *
 * Still single-writer, but no longer by a `SELECT … FOR UPDATE` on the chain head: one write
 * transaction runs on the venue file at a time, so two closers cannot both read the same head and
 * assign the same sequence number ({@link selectHead}, and `assertExtraListForWrite` in
 * `packages/catalogue/src/extras.ts` for the measurement and its control). The workforce time-entry
 * chain (`packages/workforce/src/chain.ts`) and the fiscal huella chain
 * (`packages/fiscal-verifactu/src/chain.ts`) made the same change. There is NO retry loop — unlike
 * those two, whose head must be CREATED on first use and so was briefly raced; a collision here is a
 * real bug, not something a retry fixes.
 *
 * The immutability is the table's, not this function's: `daily_closes` is declared
 * `appendOnly("daily_closes", "ledger", LEDGER)` in `packages/db/src/classification.ts`, which
 * `applyMigrations` turns into the refusing trigger pair (`packages/migrations/src/apply.ts`, its
 * `installAppendOnlyTriggers` call).
 */
export async function recordDailyClose(
  tx: Transaction,
  input: RecordDailyCloseInput,
): Promise<DailyCloseRecord> {
  // 1. Validate the supplied cash counts up front — fail before reading the chain head.
  const counts = validateCashCounts(input.cashCounts);

  // 2. Read this node's chain head. What keeps two closers from reading the same head and then
  //    assigning the same next sequence number is the write queue, not a clause here — selectHead.
  const head = await readChainHead(tx, input.nodeId);

  // 3. Compute the VAT-exact close (8a): a deterministic read over the day's immutable records.
  const close = await computeDailyClose(tx, {
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    timeZone: input.timeZone,
    dayCutover: input.dayCutover,
  });

  // 4. Reconcile the physical counts against the close's cash takings, per till → the frozen document.
  const snapshot = reconcile(close, counts);

  // 5. Hash. Truncate closedAt to whole seconds BEFORE it enters BOTH the row and the digest — the
  //    single choke point — so a stored close re-verifies: Postgres keeps sub-second precision that a
  //    second-granular read-back drops, and hashing at whole-second granularity is what keeps the
  //    committed digest and the recomputed one identical (mirrors chain.ts's truncateToWholeSecond).
  const sequenceNo = head.sequenceNo + 1;
  const prevEntryHash = head.lastEntryHash;
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

  // 6. Append the immutable row. A second close of the same day trips
  //    daily_closes_business_day_key → close.already_closed.
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

  // 7. Advance the head, in the same transaction as the read in step 2.
  await tx
    .update(dailyCloseChain)
    .set({ sequenceNo, lastEntryHash: entryHash })
    .where(eq(dailyCloseChain.nodeId, input.nodeId));

  // 8.
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
 * The table and columns a second close of the same day collides on: `daily_closes_business_day_key`,
 * declared `UNIQUE("node_id","business_day")` in migration `0033` line 236, in `packages/db/drizzle/`
 * (the baseline's three-column version, which carried the retired tenant column, was dropped
 * at line 17 of the same file).
 * Its sibling `daily_closes_sequence_key` differs in the second column alone.
 */
const BUSINESS_DAY_KEY: ConstraintTarget = {
  table: "daily_closes",
  columns: ["node_id", "business_day"],
};

const ZERO = decimal("0.00");

/** Floors a Date to whole-second granularity, preserving the instant. `Math.floor` matches Postgres
 * `date_trunc('second', …)` for the (always positive) instants a close records. */
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

/** Parses a supplied money figure and rejects a negative or non-numeric one. The field is a plain
 * `string` on the input interface — an operator's cash count crosses the boundary as untrusted text —
 * so it is validated here into a `Decimal` rather than trusted (the §3 defect class: "safe values" is
 * a property of the caller, not the code). `reason` is a stable English discriminator, never a user
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
 * overage, negative a shortage. `cashTakings` is COPIED from `close.cash.byTill[].cashTakings` (the
 * fiscal record), never re-derived. Two faults are caught here because they need the computed close:
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

  // Deterministic order (branch-free code-unit compare, matching the hash's own canonicalisation) so
  // the frozen document reads the same however the counts were enumerated.
  byTill.sort((a, b) => Number(a.tillId > b.tillId) - Number(a.tillId < b.tillId));

  const nodeVariance = byTill.reduce<Decimal>((sum, r) => addDecimal(sum, r.cashVariance), ZERO);
  return { close, cashReconciliation: { byTill, nodeVariance } };
}

interface ChainHead {
  sequenceNo: number;
  lastEntryHash: string;
}

/**
 * This node's chain head, or `undefined` when it has none yet.
 *
 * This was `selectHeadForUpdate` and it took `for update` on the head row: the sequence number read
 * here decides the NEXT one several statements later (step 5 in `recordDailyClose`), so a second
 * close reading the same head would compute the same position. There is no second close to overlap
 * with — one write transaction runs on the venue file at a time, and the pattern is stated once,
 * with its measurement and its control, on `assertExtraListForWrite`
 * (`packages/catalogue/src/extras.ts`). Drizzle's SQLite query builder has no `.for()` at all.
 * Renamed with the clause: a function named for a lock it does not take is a false claim, the same
 * rename `packages/workforce/src/chain.ts` and `packages/fiscal-verifactu/src/chain.ts` made.
 *
 * The lock was never the only thing keeping two closes off one sequence number. Both unique
 * indexes survive on this engine — `daily_closes_sequence_key` on `(node_id, sequence_no)` and
 * `daily_closes_business_day_key` on `(node_id, business_day)`, declared at
 * `packages/db/drizzle/0000_baseline.sql:665-666` — and each is now watched REFUSING a real
 * duplicate, by `surfaces a sequence-key collision RAW, not masked as close.already_closed` and by
 * `reports the business-day key as the table and columns insertClose recognises`, both in
 * `record-daily-close.test.ts`. Each drives the refusal through the engine rather than crafting an
 * error, and reads back which index collided.
 */
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
 * This node's chain head, creating it if it has none yet.
 *
 * `insert … on conflict do nothing` then a re-select, not an upsert-returning. On PostgreSQL that
 * shape was about a concurrent uncommitted insert; here it is the plain read-back of whichever row
 * exists, and it is still two statements because a single `… returning` gives nothing back for a
 * conflicting row and would leave the caller with no head to act on.
 *
 * This was `lockChainHead` and it took no lock of its own — {@link selectHead} did, and that clause
 * is gone for the reason stated there. Renamed with it, the same way
 * `packages/workforce/src/chain.ts` renamed its own.
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
 * Appends the immutable row in a savepoint (the adapter's nested `tx.transaction`). Its body is one
 * insert, which SQLite backs out by itself when refused, leaving the transaction usable, so today
 * it changes nothing (`bench/sqlite-failover/README.md`). Only a
 * `daily_closes_business_day_key` collision — a second close of the same day — is
 * translated to `close.already_closed`; anything else (a `daily_closes_sequence_key` collision,
 * which the write queue's one-writer-at-a-time should make unreachable, or an FK violation)
 * propagates raw, because masking it as "already closed" would hide a genuine single-writer bug for
 * a day that is NOT closed.
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
 * same (node, business day)?
 *
 * Why the question needs both the SQLSTATE and the key is `refusalOn`'s own doc
 * (`packages/db/src/constraint-target.ts`). What is specific to this caller: the sibling the
 * SQLSTATE alone would let through is `daily_closes_sequence_key`, and a sequence collision should
 * be unreachable while one write transaction runs on the venue file at a time, so reporting one as
 * "already closed" would hide a single-writer bug for a day that is NOT closed.
 *
 * Exported for the crafted-error unit tests, not from the barrel.
 */
export function isBusinessDayConflict(error: unknown): boolean {
  return refusalOn(error, UNIQUE_VIOLATION, BUSINESS_DAY_KEY);
}
