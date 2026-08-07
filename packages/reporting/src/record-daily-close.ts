// Side-effect only: registers this package's `close.*` codes on the shared `ErrorParams` registry by
// declaration merging. See ./errors.ts for the codes and the reasoning, and
// ./errors.reachability.test.ts for the mechanical check that keeps that augmentation reachable from
// the public barrel. Every file that throws a code imports its registry directly.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError, addDecimal, compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import type { Decimal, NodeId, TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { dailyCloseChain, dailyCloses } from "@waitron/db";
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
 * operation"), run inside the caller's transaction. It locks the (tenant, node) chain head, computes
 * the VAT-exact close (8a), reconciles the physical cash counts against it per till, and appends one
 * immutable, hash-chained `daily_closes` row — advancing the head under the same lock.
 *
 * Single-writer by a `SELECT … FOR UPDATE` on the chain head, exactly like the workforce time-entry
 * chain (`packages/workforce/src/chain.ts`) and the fiscal huella chain: two closers cannot both read
 * the same head and assign the same sequence number. There is NO retry loop — unlike those chains,
 * whose head must be CREATED on first use and so is briefly raced. Here a create race resolves the
 * same way (`insert … on conflict do nothing` then a locking re-select), and every later close finds
 * the row and locks it; a collision that survives the lock is a real bug, not something a retry fixes.
 * The immutability (append-only under the app role, FORCE RLS, the append-only trigger) is the table's
 * — `packages/db`'s 0033 migration and its `daily-closes.rls.test.ts` — not this function's.
 */
export async function recordDailyClose(
  tx: Transaction,
  input: RecordDailyCloseInput,
): Promise<DailyCloseRecord> {
  // 1. Validate the supplied cash counts up front — fail before taking the chain lock or reading.
  const counts = validateCashCounts(input.cashCounts);

  // 2. Serialise this (tenant, node)'s closes on the chain head. FOR UPDATE, not FOR SHARE: two
  //    closers must not both read the same head and then both assign the same next sequence number.
  const head = await lockChainHead(tx, input.tenantId, input.nodeId);

  // 3. Compute the VAT-exact close (8a): a deterministic read over the day's immutable records.
  const close = await computeDailyClose(tx, {
    tenantId: input.tenantId,
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
      tenantId: input.tenantId,
      nodeId: input.nodeId,
      businessDay: input.businessDay,
      sequenceNo,
      closedAt,
      closedBy: input.closedBy,
      snapshot,
    },
    prevEntryHash,
  );

  // 6. Append the immutable row inside a savepoint. A second close of the same day trips
  //    daily_closes_business_day_key (23505) → close.already_closed; the savepoint confines that abort
  //    to the failed insert so the caller's enclosing transaction is not poisoned by it.
  const id = await insertClose(tx, {
    tenantId: input.tenantId,
    nodeId: input.nodeId,
    businessDay: input.businessDay,
    sequenceNo,
    prevEntryHash,
    entryHash,
    closedAt,
    closedBy: input.closedBy,
    snapshot,
  });

  // 7. Advance the head under the lock taken in step 2.
  await tx
    .update(dailyCloseChain)
    .set({ sequenceNo, lastEntryHash: entryHash })
    .where(
      and(eq(dailyCloseChain.tenantId, input.tenantId), eq(dailyCloseChain.nodeId, input.nodeId)),
    );

  // 8.
  return {
    id,
    tenantId: input.tenantId,
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

const UNIQUE_VIOLATION = "23505";
const BUSINESS_DAY_KEY = "daily_closes_business_day_key";

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

async function selectHeadForUpdate(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<ChainHead | undefined> {
  const [row] = await tx
    .select({
      sequenceNo: dailyCloseChain.sequenceNo,
      lastEntryHash: dailyCloseChain.lastEntryHash,
    })
    .from(dailyCloseChain)
    .where(and(eq(dailyCloseChain.tenantId, tenantId), eq(dailyCloseChain.nodeId, nodeId)))
    .for("update");
  return row;
}

/**
 * Takes the chain-head row lock, creating the head if this node has none yet. `insert … on conflict
 * do nothing` then a locking re-select, not an upsert-returning: when a concurrent transaction has
 * inserted the head but not committed, this transaction's speculative insert waits on it and then does
 * nothing on the conflict, so the re-select observes the COMMITTED row rather than one that might roll
 * back. Same shape as workforce's `lockChainHead`, keyed by (tenant, node).
 */
async function lockChainHead(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<ChainHead> {
  const existing = await selectHeadForUpdate(tx, tenantId, nodeId);
  if (existing !== undefined) return existing;

  await tx
    .insert(dailyCloseChain)
    .values({ tenantId, nodeId })
    .onConflictDoNothing({ target: [dailyCloseChain.tenantId, dailyCloseChain.nodeId] });

  const created = await selectHeadForUpdate(tx, tenantId, nodeId);
  /* v8 ignore start */
  if (created === undefined) {
    // Unreachable: the insert commits a fresh row or a concurrent insert wins the conflict and
    // commits one; the re-select then locks whichever exists.
    throw new Error("daily_close_chain: head row missing immediately after insert-on-conflict");
  }
  /* v8 ignore stop */
  return created;
}

interface CloseRow {
  tenantId: TenantId;
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
 * Appends the immutable row in a savepoint (`tx.transaction`, which Drizzle emits as SAVEPOINT /
 * RELEASE / ROLLBACK TO SAVEPOINT). The savepoint is not decoration: in Postgres a unique violation
 * aborts the WHOLE enclosing transaction, so without it a caller could not translate the failure and
 * continue. Only a `daily_closes_business_day_key` collision — a second close of the same day — is
 * translated to `close.already_closed`; anything else (an impossible-under-the-lock
 * `daily_closes_sequence_key` collision, an FK violation) propagates raw, because masking it as
 * "already closed" would hide a genuine single-writer bug for a day that is NOT closed.
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
 * Is this (or anything it wraps) a unique violation on `daily_closes_business_day_key` — a second
 * close of the same (tenant, node, business day)? Walks the cause chain because Drizzle wraps every
 * failed query in a `DrizzleQueryError` whose own `.code` is undefined; the real SQLSTATE and the
 * `.constraint` name live on `.cause` (node-postgres), one level deeper still under PGlite. Stops at a
 * fixed depth so a self-referential `cause` cannot spin forever. Reads the CONSTRAINT NAME, not just
 * the 23505 code, so a `daily_closes_sequence_key` collision is deliberately NOT matched. Mirrors
 * `@waitron/db`'s `isUniqueViolation` shape (extended with the constraint check) rather than reaching
 * for the test-only `pgErrorCode`. Exported for the crafted-error unit tests, not from the barrel.
 */
export function isBusinessDayConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION &&
      (current as { constraint?: unknown }).constraint === BUSINESS_DAY_KEY
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}
