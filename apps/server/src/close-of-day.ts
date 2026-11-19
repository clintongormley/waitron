import { and, count, eq, inArray, isNotNull, max } from "drizzle-orm";
import {
  invoiceSeries,
  parties,
  workingOrderLines,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { decimalToCents, isAppError, jobOrigin } from "@waitron/shared";
import { stillOwedOnIssuedBill } from "./bill-payments.js";
import { pinnedAt } from "./issue-moment.js";
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
  const openedAt = rule.openedAt?.(billId)?.getTime() ?? Date.parse(bill.openedAt);
  const [series] = await tx
    .select({ retiredAt: max(invoiceSeries.retiredAt) })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, cfg.nodeId), isNotNull(invoiceSeries.retiredAt)));
  const retiredAt = series?.retiredAt == null ? undefined : new Date(series.retiredAt);
  if (retiredAt !== undefined && openedAt <= retiredAt.getTime()) return undefined;
  if (openedAt >= rule.dayStartedAt.getTime()) return undefined;
  return { status: bill.status, partyId: bill.partyId!, openedBy: bill.openedBy };
}
