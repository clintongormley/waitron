import { and, count, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { withIssuanceTransaction } from "@waitron/core";
import {
  parties,
  readVenueClock,
  workingOrderLines,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import {
  businessDayAt,
  businessDayBounds,
  decimalToCents,
  isAppError,
  jobOrigin,
  type BusinessDayClock,
} from "@waitron/shared";
import { clockUnconfirmedRefusal, stillOwedOnIssuedBill } from "./bill-payments.js";
import { pinnedAt } from "./issue-moment.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { bumpPartyRevision } from "./parties.js";
import { readIssuedSales } from "./sale-due.js";
import { refuseBillPaymentInFlight, settleIssuedOwingNothing } from "./till-sale.js";
import type { TradingAdmission } from "./trading-admission.js";
import type { SaleOriginConfig, TradingContext } from "./trading-context.js";
import {
  issueUnpaidInvoice,
  markOrderPlaced,
  ordersWithUnfiredDish,
  priceForIssuance,
  type PricedInvoice,
} from "./working-order.js";
import "./errors.js";

/** What "due" means for one call: bills counted as opened before `dayStartedAt` are due, and
 * `venueClock` places a bill's opening in its business day. */
export interface CloseOfDayRule {
  dayStartedAt: Date;
  venueClock: BusinessDayClock;
}

const MONEY_MOVING: ReadonlySet<string> = new Set([
  "bill.refund_in_progress",
  "order.payment_in_flight",
]);

export type CloseOfDayOutcome =
  | { kind: "issued"; saleId: string }
  | { kind: "not_due" }
  /** A payment, a refund or a correction of one of its advances is still under way: try again
   * later. */
  | { kind: "money_moving" }
  | { kind: "left_open"; reason: "dish_not_made" | "owes_nothing" };

export interface CloseOfDayDeps {
  admission: TradingAdmission;
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  log?: Logger;
}

export function closeOfDayConfig(base: TradingContext): SaleOriginConfig {
  return { ...base, origin: jobOrigin("business_day_close") };
}

/**
 * Issue one table bill's ticket at the end of the business day, for its whole total, paid or not,
 * as Print the bill does, but printing no receipt and sending nothing to the kitchen. The ticket names
 * the person who seated the table. A refusal from the issue path throws, for the caller's
 * transaction to roll back.
 */
export async function issueBillAtClose(
  tx: Transaction,
  deps: CloseOfDayDeps,
  cfg: SaleOriginConfig,
  billId: string,
  rule: CloseOfDayRule,
): Promise<CloseOfDayOutcome> {
  const bill = await readDueBill(tx, cfg.nodeId, billId, rule);
  if (bill === undefined) return { kind: "not_due" };
  const reading = deps.clock.now();
  await deps.backend.refuseUntilRecordable(tx, reading);
  try {
    await refuseBillPaymentInFlight(deps.db, tx, billId, bill.status);
  } catch (error) {
    if (isAppError(error) && MONEY_MOVING.has(error.code)) return { kind: "money_moving" };
    throw error;
  }
  // A walkout refuses such a bill until staff cancel the dish (D4); once issued it would not.
  if ((await ordersWithUnfiredDish(tx, [billId])).has(billId))
    return { kind: "left_open", reason: "dish_not_made" };

  // Dated by closeOfDayEnd, as every path that issues a bill the close counts as due is.
  let invoice: PricedInvoice;
  try {
    invoice = await priceForIssuance(
      tx,
      pinnedAt(deps.clock, reading),
      deps.backend,
      cfg,
      billId,
      deps.log,
    );
  } catch (error) {
    if (codeOf(error) === "advance.correction_open") return { kind: "money_moving" };
    throw error;
  }
  const total = invoice.priced.total;
  const owed = await stillOwedOnIssuedBill(tx, billId, total);
  if (decimalToCents(total) !== 0 && decimalToCents(owed) <= 0)
    return { kind: "left_open", reason: "owes_nothing" };
  // Unlike Print the bill, a staged delivery that fails or cannot be reserved does not stop the
  // close: nobody is there to hand it to.
  const { saleId } = await issueUnpaidInvoice(
    tx,
    deps.backend,
    cfg,
    invoice,
    bill.openedBy,
    deps.admission,
  );
  if (bill.status === "open") await markOrderPlaced(tx, deps.clock, cfg, billId, bill.openedBy);
  if (decimalToCents(total) === 0) await settleIssuedOwingNothing(tx, deps, billId, saleId);
  await bumpPartyRevision(tx, bill.partyId);
  deps.log?.("info", "close_of_day.issued", { workingOrderId: billId, saleId });
  return { kind: "issued", saleId };
}

/** The bill the close considers once its business day is over: a table bill with lines,
 * opened by this node with a trusted opening time, that no restore left for staff (D6). */
async function readCloseableBill(tx: Transaction, nodeId: string, billId: string) {
  const [bill] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      nodeId: workingOrders.nodeId,
      openedAt: workingOrders.trustedOpenedAt,
      openedBy: parties.openedBy,
      lines: count(workingOrderLines.id),
    })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(
      and(
        eq(workingOrders.id, billId),
        inArray(workingOrders.status, ["open", "placed"]),
        eq(workingOrders.beforeRestore, false),
      ),
    )
    .groupBy(workingOrders.id);
  if (bill === undefined || bill.lines === 0 || bill.nodeId !== nodeId || bill.openedAt === null)
    return undefined;
  return {
    status: bill.status,
    partyId: bill.partyId!,
    openedBy: bill.openedBy,
    openedAt: bill.openedAt,
  };
}

/** {@link readCloseableBill}'s bill when it is due under `rule`. */
async function readDueBill(tx: Transaction, nodeId: string, billId: string, rule: CloseOfDayRule) {
  const bill = await readCloseableBill(tx, nodeId, billId);
  return bill !== undefined && (await isDue(tx, billId, bill.openedAt, rule)) ? bill : undefined;
}

/** Opened before the day began, and with no sale yet. */
async function isDue(
  tx: Transaction,
  billId: string,
  openedAt: string,
  rule: CloseOfDayRule,
): Promise<boolean> {
  return openedInDueSpan(openedAt, rule) && !(await readIssuedSales(tx, [billId])).has(billId);
}

/**
 * The end of the business day `billId` was opened in, when that day has ended by `issuedAt` and the
 * close counts the bill as due ({@link readDueBill}): the latest moment its meal can have ended,
 * whichever path issues it. Undefined otherwise. A bill holding a dish the kitchen was never asked
 * for is left open by the close, so its meal has not ended; a payment still moving only makes the
 * close try again. A bill paid in full before that day ended, which the close leaves open, is dated
 * by this too rather than by its last payment.
 */
export async function closeOfDayEnd(
  tx: Transaction,
  scope: { nodeId: string },
  billId: string,
  issuedAt: Date,
): Promise<string | undefined> {
  const bill = await readCloseableBill(tx, scope.nodeId, billId);
  if (bill === undefined) return undefined;
  const venueClock = await readVenueClock(tx);
  const rule = { dayStartedAt: dayStartAt(venueClock, issuedAt), venueClock };
  if (!(await isDue(tx, billId, bill.openedAt, rule))) return undefined;
  if ((await ordersWithUnfiredDish(tx, [billId])).has(billId)) return undefined;
  return dayEndedAt(venueClock, bill.openedAt);
}

/** The start of the business day `at` falls in. */
function dayStartAt(venueClock: BusinessDayClock, at: Date): Date {
  return new Date(businessDayBounds(venueClock, businessDayAt(venueClock, at)).startAt);
}

/** The end of the business day the bill was opened in. */
function dayEndedAt(venueClock: BusinessDayClock, openedAt: string): string {
  return businessDayBounds(venueClock, businessDayAt(venueClock, new Date(openedAt))).endAt;
}

/** Before the day began, counted from the bill's trusted opening time; a bill with none yet is
 * never due. */
function openedInDueSpan(trustedOpenedAt: string | null, rule: CloseOfDayRule): boolean {
  return trustedOpenedAt !== null && Date.parse(trustedOpenedAt) < rule.dayStartedAt.getTime();
}

/** Table bills that look due under `rule`; `issueBillAtClose` checks each again in its own
 * transaction. */
async function dueBills(tx: Transaction, nodeId: string, rule: CloseOfDayRule): Promise<string[]> {
  const rows = await tx
    .select({ id: workingOrders.id, openedAt: workingOrders.trustedOpenedAt })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(
      and(
        eq(workingOrders.nodeId, nodeId),
        inArray(workingOrders.status, ["open", "placed"]),
        eq(workingOrders.beforeRestore, false),
        exists(
          tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, workingOrders.id)),
        ),
      ),
    )
    .orderBy(sql`${workingOrders}.rowid`);
  const issuedSales = await readIssuedSales(
    tx,
    rows.map((row) => row.id),
  );
  return rows
    .filter((row) => !issuedSales.has(row.id) && openedInDueSpan(row.openedAt, rule))
    .map((row) => row.id);
}

const UNTRUSTED = (nodeId: string) =>
  and(
    eq(workingOrders.nodeId, nodeId),
    isNull(workingOrders.trustedOpenedAt),
    inArray(workingOrders.status, ["open", "placed"]),
  );

/** Whether a bill above row `afterRow` still needs a trusted opening time, and the highest row,
 * read in one statement and without the write lock. */
function untrustedAbove(db: Database, nodeId: string, afterRow: number) {
  const [row] = db.all<{ top: number | null; pending: number }>(sql`
    select
      (select max(rowid) from working_orders) as top,
      exists (
        select 1 from ${workingOrders}
        where rowid > ${afterRow} and ${UNTRUSTED(nodeId)}
      ) as pending
  `);
  return { top: row?.top ?? 0, pending: row?.pending === 1 };
}

/** Gives this node's open bills that were opened while the time was unconfirmed `releasedAt`, the
 * trusted clock's reading when the hold ended, as their trusted opening time. */
async function stampReleasedBills(tx: Transaction, nodeId: string, releasedAt: Date) {
  await tx
    .update(workingOrders)
    .set({ trustedOpenedAt: releasedAt.toISOString() })
    .where(UNTRUSTED(nodeId));
}

export interface CloseOfDayJobDeps extends CloseOfDayDeps {
  cfg: TradingContext;
  log: Logger;
  selling: { mode: () => string; role: () => string; fenced: () => boolean };
  clockUnconfirmed: () => boolean;
  /** Grows each time a hold `clockUnconfirmed` covers begins, so a hold between two looks is seen. */
  clockHoldsBegun: () => number;
  /** The trusted clock's reading when the latest hold ended, set as the gate opens; null when
   * unknown, and the pass's own reading stands in. */
  clockReleasedAt: () => Date | null;
}

const LOOK_MS = 60_000;

/**
 * Each minute, issues through `issueBillAtClose` the table bills still open after the business day
 * they were opened in ended. The bill query runs on the first look, once a day's end has passed
 * since the last, when the clock gate lets go, and after a look that left work for later.
 */
export function closeOfDayJob(deps: CloseOfDayJobDeps): JobDefinition {
  const cfg = closeOfDayConfig(deps.cfg);
  // A start may have waited for its time, and an earlier process may have stopped before its
  // release stamp.
  let held = true;
  let holdsSeen: number | undefined;
  // Rows up to here held no bill needing a stamp when last read. A bill whose transaction read the
  // gate holding but committed after that read has a higher row, as writes take turns.
  let scannedUpTo = 0;
  let queryAgain = true;
  let queriedDayStart = 0;

  function applies(): boolean {
    return (
      deps.selling.mode() === "primary" &&
      deps.selling.role() === "primary" &&
      !deps.selling.fenced()
    );
  }

  /** Why the pass must stop before its next bill: `holds` is the count the pass read at its start,
   * and its cutoff is only good while no hold has begun since. */
  function stopBeforeBill(holds: number, signal: AbortSignal): "hold" | "stepdown" | undefined {
    if (deps.clockUnconfirmed() || deps.clockHoldsBegun() !== holds) return "hold";
    if (signal.aborted || !applies()) return "stepdown";
    return undefined;
  }

  async function issueDue(rule: CloseOfDayRule, holds: number, signal: AbortSignal): Promise<void> {
    let due: string[];
    try {
      due = await withTransaction(deps.db, (tx) => dueBills(tx, cfg.nodeId, rule));
    } catch (error) {
      queryAgain = true;
      throw error;
    }
    const failures: unknown[] = [];
    for (const billId of due) {
      let stop = stopBeforeBill(holds, signal);
      try {
        if (stop === undefined) {
          // Checked again under the write lock: a hold or a stepdown may have begun while this
          // waited for it.
          const outcome = await withIssuanceTransaction(
            deps.db,
            async (tx) => {
              stop = stopBeforeBill(holds, signal);
              return stop === undefined
                ? await issueBillAtClose(tx, deps, cfg, billId, rule)
                : null;
            },
            deps.log,
          );
          if (outcome?.kind === "money_moving") queryAgain = true;
        }
      } catch (error) {
        if (clockUnconfirmedRefusal(error)) {
          endUntilRelease();
          break;
        }
        if (codeOf(error) === "venue.time_zone_not_ready") {
          queryAgain = true;
          break;
        }
        deps.log("warn", "close_of_day.issue_failed", {
          workingOrderId: billId,
          errorCode: codeOf(error),
        });
        failures.push(error);
      }
      if (stop === "hold") {
        endUntilRelease();
        break;
      }
      if (stop === "stepdown") {
        queryAgain = true;
        break;
      }
    }
    if (failures.length > 0) {
      queryAgain = true;
      throw failures[0];
    }
  }

  function endUntilRelease(): void {
    held = true;
    queryAgain = true;
  }

  return {
    name: "bills.close_of_day",
    applies,
    wakeOn: ["day_cutover_changes", "settings.business_day"],
    // The pass reads the trusted clock; the runner sleeps on the wall clock.
    minSleepMs: 500,
    maxSleepMs: LOOK_MS,
    backoff: { firstMs: 5_000, maxMs: 300_000 },
    async pass({ signal }) {
      const holds = deps.clockHoldsBegun();
      if (deps.clockUnconfirmed()) {
        held = true;
        return { nextDueAt: null };
      }
      if (holds !== holdsSeen) held = true;
      holdsSeen = holds;
      const reading = deps.clock.now().instant;
      const scan = untrustedAbove(deps.db, cfg.nodeId, scannedUpTo);
      if (scan.pending) {
        // Checked again under the write lock: a hold begun since the count was read may have
        // opened bills after the release read here, so the stamp waits for that hold's own.
        const stop = await withTransaction(deps.db, async (tx) => {
          const before = stopBeforeBill(holds, signal);
          if (before === undefined)
            await stampReleasedBills(tx, cfg.nodeId, deps.clockReleasedAt() ?? reading);
          return before;
        });
        if (stop === "hold") held = true;
        if (stop !== undefined) return { nextDueAt: null };
        queryAgain = true;
      }
      scannedUpTo = scan.top;
      if (held) {
        held = false;
        queryAgain = true;
      }
      const venueClock = await readVenueClock(deps.db);
      const dayStartedAt = dayStartAt(venueClock, reading);
      if (!queryAgain && dayStartedAt.getTime() <= queriedDayStart) return { nextDueAt: null };
      queryAgain = false;
      queriedDayStart = dayStartedAt.getTime();
      await issueDue({ dayStartedAt, venueClock }, holds, signal);
      return { nextDueAt: null };
    },
  };
}
