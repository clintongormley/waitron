import { and, count, eq, exists, inArray, isNotNull, max, sql } from "drizzle-orm";
import { withIssuanceTransaction } from "@waitron/core";
import {
  invoiceSeries,
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
} from "./working-order.js";
import "./errors.js";

/** What "due" means for one call: bills opened before `dayStartedAt` are due. */
export interface CloseOfDayRule {
  dayStartedAt: Date;
  /** The time a bill counts as opened at when its stored opening time is not to be trusted. */
  openedAt?: (billId: string) => Date | undefined;
}

const MONEY_MOVING: ReadonlySet<string> = new Set([
  "bill.refund_in_progress",
  "order.payment_in_flight",
]);

export type CloseOfDayOutcome =
  | { kind: "issued"; saleId: string }
  | { kind: "not_due" }
  /** A payment or refund is still moving: try again later. */
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
  return { ...base, origin: jobOrigin("trading_day_close") };
}

/**
 * Issue one table bill's ticket at the end of the business day, for its whole total, paid or not,
 * as Print the bill does, but printing nothing and sending nothing to the kitchen. The ticket names
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
  const bill = await readDueBill(tx, cfg, billId, rule);
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

  const invoice = await priceForIssuance(
    tx,
    pinnedAt(deps.clock, reading),
    deps.backend,
    cfg,
    billId,
  );
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
    deps.log,
  );
  if (bill.status === "open") await markOrderPlaced(tx, deps.clock, cfg, billId, bill.openedBy);
  if (decimalToCents(total) === 0) await settleIssuedOwingNothing(tx, deps, billId, saleId);
  await bumpPartyRevision(tx, bill.partyId);
  deps.log?.("info", "close_of_day.issued", { workingOrderId: billId, saleId });
  return { kind: "issued", saleId };
}

/** The bill when it is due under `rule`: a table bill with lines and no sale, opened by this node
 * after its latest series retirement (D6) and before the day began. */
async function readDueBill(
  tx: Transaction,
  cfg: SaleOriginConfig,
  billId: string,
  rule: CloseOfDayRule,
) {
  const [bill] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      nodeId: workingOrders.nodeId,
      openedAt: workingOrders.openedAt,
      openedBy: parties.openedBy,
      lines: count(workingOrderLines.id),
    })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(and(eq(workingOrders.id, billId), inArray(workingOrders.status, ["open", "placed"])))
    .groupBy(workingOrders.id);
  if (bill === undefined || bill.lines === 0 || bill.nodeId !== cfg.nodeId) return undefined;
  if ((await readIssuedSales(tx, [billId])).has(billId)) return undefined;
  const retiredAt = await latestRetirement(tx, cfg.nodeId);
  if (!openedInDueSpan(billId, bill.openedAt, retiredAt, rule)) return undefined;
  return { status: bill.status, partyId: bill.partyId!, openedBy: bill.openedBy };
}

async function latestRetirement(tx: Transaction, nodeId: string): Promise<number | undefined> {
  const [series] = await tx
    .select({ retiredAt: max(invoiceSeries.retiredAt) })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, nodeId), isNotNull(invoiceSeries.retiredAt)));
  return series?.retiredAt == null ? undefined : new Date(series.retiredAt).getTime();
}

/** After this node's latest series retirement (D6) and before the day began, counting the bill's
 * opening time as `rule` says. */
function openedInDueSpan(
  billId: string,
  storedOpenedAt: string,
  retiredAt: number | undefined,
  rule: CloseOfDayRule,
): boolean {
  const openedAt = rule.openedAt?.(billId)?.getTime() ?? Date.parse(storedOpenedAt);
  if (retiredAt !== undefined && openedAt <= retiredAt) return false;
  return openedAt < rule.dayStartedAt.getTime();
}

/** Bills opened while the clock gate held: rows above `after`, up to `upTo`, count as opened at
 * `releasedAt`, the trusted clock's reading when the gate let go. */
export interface ClockWindow {
  after: number;
  upTo: number;
  releasedAt: Date;
}

export function openedAtInWindows(
  windows: readonly ClockWindow[],
  rowId: number,
): Date | undefined {
  return windows.find((window) => rowId > window.after && rowId <= window.upTo)?.releasedAt;
}

/** The highest `working_orders` row id: rows are never deleted, so a later bill has a higher one. */
export function highestBillRow(db: Database): number {
  const [row] = db.all<{ top: number | null }>(sql`select max(rowid) as top from working_orders`);
  return row?.top ?? 0;
}

/** Table bills that look due under `rule`; `issueBillAtClose` checks each again in its own
 * transaction. */
async function dueBills(
  tx: Transaction,
  nodeId: string,
  rule: (rows: ReadonlyMap<string, number>) => CloseOfDayRule,
): Promise<{ ids: string[]; rule: CloseOfDayRule }> {
  const rows = await tx
    .select({
      id: workingOrders.id,
      rowId: sql<number>`${workingOrders}.rowid`,
      openedAt: workingOrders.openedAt,
    })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(
      and(
        eq(workingOrders.nodeId, nodeId),
        inArray(workingOrders.status, ["open", "placed"]),
        exists(
          tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, workingOrders.id)),
        ),
      ),
    )
    .orderBy(sql`${workingOrders}.rowid`);
  const passRule = rule(new Map(rows.map((row) => [row.id, row.rowId])));
  const issuedSales = await readIssuedSales(
    tx,
    rows.map((row) => row.id),
  );
  const retiredAt = await latestRetirement(tx, nodeId);
  const ids = rows
    .filter(
      (row) =>
        !issuedSales.has(row.id) && openedInDueSpan(row.id, row.openedAt, retiredAt, passRule),
    )
    .map((row) => row.id);
  return { ids, rule: passRule };
}

export interface CloseOfDayJobDeps extends CloseOfDayDeps {
  cfg: TradingContext;
  log: Logger;
  selling: { mode: () => string; role: () => string; fenced: () => boolean };
  clockUnconfirmed: () => boolean;
  /** The highest bill row when the start began waiting for its time: the first window opens here. */
  startMark: number;
}

const LOOK_MS = 60_000;

/**
 * Each minute, issues through `issueBillAtClose` the table bills still open after the business day
 * they were opened in ended. The bill query runs on the first look, once a day's end has passed
 * since the last, when the clock gate lets go, and after a look that left work for later.
 */
export function closeOfDayJob(deps: CloseOfDayJobDeps): JobDefinition {
  const cfg = closeOfDayConfig(deps.cfg);
  const windows: ClockWindow[] = [];
  let mark = deps.startMark;
  // The start's wait for its time is the first window.
  let held = true;
  let queryAgain = true;
  let queriedDayStart = 0;

  async function issueDue(dayStartedAt: Date): Promise<void> {
    const due = await withTransaction(deps.db, (tx) =>
      dueBills(tx, cfg.nodeId, (rows) => ({
        dayStartedAt,
        openedAt: (billId) => {
          const row = rows.get(billId);
          return row === undefined ? undefined : openedAtInWindows(windows, row);
        },
      })),
    );
    const failed: string[] = [];
    for (const billId of due.ids) {
      if (deps.clockUnconfirmed()) return endUntilRelease();
      try {
        const outcome = await withIssuanceTransaction(
          deps.db,
          (tx) => issueBillAtClose(tx, deps, cfg, billId, due.rule),
          deps.log,
        );
        if (outcome.kind === "money_moving") queryAgain = true;
      } catch (error) {
        if (clockUnconfirmedRefusal(error)) return endUntilRelease();
        if (codeOf(error) === "venue.time_zone_not_ready") return void (queryAgain = true);
        deps.log("warn", "close_of_day.issue_failed", {
          workingOrderId: billId,
          errorCode: codeOf(error),
        });
        failed.push(billId);
      }
    }
    if (failed.length > 0) {
      queryAgain = true;
      throw new Error(`close_of_day.issue_failed: ${failed.join(", ")}`);
    }
  }

  function endUntilRelease(): void {
    held = true;
    queryAgain = true;
  }

  return {
    name: "bills.close_of_day",
    applies: () =>
      deps.selling.mode() === "primary" &&
      deps.selling.role() === "primary" &&
      !deps.selling.fenced(),
    wakeOn: ["day_cutover_changes", "settings.business_day"],
    // The pass reads the trusted clock; the runner sleeps on the wall clock.
    minSleepMs: 500,
    maxSleepMs: LOOK_MS,
    backoff: { firstMs: 5_000, maxMs: 300_000 },
    async pass() {
      if (deps.clockUnconfirmed()) {
        held = true;
        return { nextDueAt: null };
      }
      const top = highestBillRow(deps.db);
      const reading = deps.clock.now().instant;
      if (held) {
        if (top > mark) windows.push({ after: mark, upTo: top, releasedAt: reading });
        held = false;
        queryAgain = true;
      }
      mark = top;
      const venueClock = await withTransaction(deps.db, (tx) => readVenueClock(tx));
      const dayStartedAt = new Date(
        businessDayBounds(venueClock, businessDayAt(venueClock, reading)).startAt,
      );
      if (!queryAgain && dayStartedAt.getTime() <= queriedDayStart) return { nextDueAt: null };
      queryAgain = false;
      queriedDayStart = dayStartedAt.getTime();
      await issueDue(dayStartedAt);
      return { nextDueAt: null };
    },
  };
}
