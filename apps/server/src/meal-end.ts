import { eq, inArray, and, isNull, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  orderGroups,
  ticketItems,
  unpaidDepartures,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { staffPresentationName } from "@waitron/menu";
import { AppError, decimalToCents, thousandthsToDecimal } from "@waitron/shared";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { parseBillEditExpecteds, requireBillEditors } from "./bill-editing.js";
import { stillOwedOnIssuedBill } from "./bill-payments.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { assertProfileAction, type DeviceBinding } from "./device-session.js";
import { pinnedAt } from "./issue-moment.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import type { Logger } from "./logger.js";
import type { BillEditExpected } from "./order-drafts.js";
import { billOwes, checkAndBumpParty, partyFamily, runServiceCommand } from "./parties.js";
import { enqueueOriginalReceipt, printerLookup } from "./receipt-print.js";
import { readIssuedSales } from "./sale-due.js";
import {
  readSettledTicket,
  refuseBillPaymentInFlight,
  settleIssuedOwingNothing,
} from "./till-sale.js";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import {
  isReleased,
  issueUnpaidInvoice,
  markOrderPlaced,
  priceForIssuance,
  readInvoiceNumbers,
} from "./working-order.js";
import "./errors.js";

export interface EndMealRequest {
  billId: string;
  expectedPartyRevision: number;
  expectedEdits: BillEditExpected[];
  submissionId: string;
  printAnyway: boolean;
}

export interface EndedMeal {
  revision: number;
  workingOrderId: string;
  saleId: string;
  invoiceNumber: string;
  total: string;
  owed: string;
}

/**
 * Print the bill: issue one bill's ticket for its whole total now, paid or not, and leave its party
 * seated. A bill already holding a ticket is refused, so a bill is never issued twice. A bill that
 * needs paper is refused, as `POST /api/sales/:id/receipt` is, when `device`'s profile may not print
 * receipts; `null` (no device) passes.
 */
export async function endMeal(
  tx: Transaction,
  deps: {
    admission: TradingAdmission;
    db: Database;
    backend: FiscalBackend;
    clock: TrustedClock;
    log?: Logger;
    attendance?: AttendanceRecorder;
  },
  cfg: DeviceRequestConfig,
  partyId: string,
  req: EndMealRequest,
  operatorId: string,
  device: DeviceBinding | null,
): Promise<EndedMeal> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    req.submissionId,
    "party.end_meal",
    { partyId, billId: req.billId, printAnyway: req.printAnyway, operatorId },
    async () => {
      await requireEconomicWrite(tx, cfg, deps.admission);
      const reading = deps.clock.now();
      await deps.backend.refuseUntilRecordable(tx, reading);
      const revision = await checkAndBumpParty(tx, partyId, req.expectedPartyRevision, "open");
      const bill = await readFamilyBill(tx, partyId, req.billId);
      if (bill === undefined)
        throw new AppError("working_order.not_open", { workingOrderId: req.billId });
      await requireBillEditors(
        tx,
        [req.billId],
        operatorId,
        parseBillEditExpecteds(req.expectedEdits).filter((edit) => edit.billId === req.billId),
      );
      await assertBillHasNoUnsent(tx, req.billId);
      if ((await readIssuedSales(tx, [req.billId])).has(req.billId))
        throw new AppError("meal_end.already_issued", { workingOrderId: req.billId });
      if (!billOwes(bill))
        throw new AppError("bill.nothing_outstanding", { workingOrderId: req.billId });
      await refuseBillPaymentInFlight(deps.db, tx, req.billId, bill.status);
      const printers = printerLookup(tx, cfg.origin);
      const paper = needsPaper(bill);
      if (paper) assertProfileAction(device, "print-receipt", "receipt");
      if (paper && (await printers("receipt")) === undefined)
        throw new AppError("meal_end.no_printer", { workingOrderId: req.billId });
      if (!req.printAnyway) {
        const dishes = await unservedDishes(tx, req.billId);
        if (dishes.length > 0)
          throw new AppError("meal_end.unserved_dishes", { workingOrderId: req.billId, dishes });
      }

      const invoice = await priceForIssuance(
        tx,
        pinnedAt(deps.clock, reading),
        deps.backend,
        cfg,
        req.billId,
      );
      const total = invoice.priced.total;
      const owed = await stillOwedOnIssuedBill(tx, req.billId, total);
      if (decimalToCents(total) !== 0 && decimalToCents(owed) <= 0)
        throw new AppError("bill.nothing_outstanding", { workingOrderId: req.billId });
      const { saleId } = await issueUnpaidInvoice(
        tx,
        deps.backend,
        cfg,
        invoice,
        operatorId,
        deps.admission,
        deps.log,
      );
      if (!paper)
        await assertDeliveryQueued(tx, req.billId, bill.delivery!.medium as "a4" | "email", saleId);
      if (bill.status === "open")
        await markOrderPlaced(tx, deps.clock, cfg, req.billId, operatorId, deps.attendance);
      if (decimalToCents(total) === 0) await settleIssuedOwingNothing(tx, deps, req.billId, saleId);
      let invoiceNumber: string;
      if (paper) {
        const ticket = await readSettledTicket(deps.backend, tx, cfg, req.billId);
        await enqueueOriginalReceipt(tx, cfg, ticket, saleId, { printers, personId: operatorId });
        invoiceNumber = ticket.invoiceNumber;
      } else {
        invoiceNumber = (await readInvoiceNumbers(tx, [saleId])).get(saleId)!;
      }
      return { revision, workingOrderId: req.billId, saleId, invoiceNumber, total, owed };
    },
  );
}

/**
 * `issueUnpaidInvoice` reserves a staged A4 or email delivery as an optional document, so a
 * destination switched off since staging, or a reservation that failed, still issues. Printing the
 * bill exists to put it in front of the guest, so here either refuses and the issue rolls back.
 */
async function assertDeliveryQueued(
  tx: Transaction,
  billId: string,
  medium: "a4" | "email",
  saleId: string,
) {
  const [delivery] = await tx
    .select({ status: invoiceDeliveries.status })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.saleId, saleId),
        eq(invoiceDeliveries.requestKey, `issuance:${saleId}`),
      ),
    );
  if (delivery === undefined || delivery.status === "failed")
    throw new AppError("meal_end.delivery_unavailable", {
      workingOrderId: billId,
      medium,
    });
}

/** The bill, when it belongs to the party's family, with what Print the bill decides on. */
async function readFamilyBill(tx: Transaction, partyId: string, billId: string) {
  const [bill] = await tx
    .select({
      status: workingOrders.status,
      leftUnpaid: sql<boolean>`${unpaidDepartures.id} is not null`.mapWith(Boolean),
      lines: sql<number>`count(${workingOrderLines.id})`,
      invoiceType: workingOrders.invoiceType,
      delivery: workingOrders.invoiceDelivery,
    })
    .from(workingOrders)
    .leftJoin(unpaidDepartures, eq(unpaidDepartures.workingOrderId, workingOrders.id))
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(
      and(
        eq(workingOrders.id, billId),
        inArray(workingOrders.partyId, await partyFamily(tx, partyId)),
      ),
    )
    .groupBy(workingOrders.id);
  return bill;
}

/** A full invoice staged for A4 or email has its delivery reserved by `issueUnpaidInvoice`. */
function needsPaper(
  bill: Pick<NonNullable<Awaited<ReturnType<typeof readFamilyBill>>>, "invoiceType" | "delivery">,
): boolean {
  const medium = bill.delivery?.medium;
  return bill.invoiceType !== "F1" || (medium !== "a4" && medium !== "email");
}

/** The bill's dishes neither served in full nor cancelled, as Finish table reckons them. */
async function unservedDishes(tx: Transaction, billId: string) {
  const lines = await tx
    .select({
      line: workingOrderLines,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketMadeHere: ticketItems.madeHere,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        isNull(sql`+${workingOrderLines.parentLineId}`),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const cancelled = await readLineCancellations(
    tx,
    lines.map(({ line }) => line.id),
  );
  return lines.flatMap((row) => {
    const { remaining } = serviceQuantities(
      row.line.quantity,
      row.line.servedQuantity,
      cancelled.get(row.line.id) ?? 0,
    );
    return remaining === 0
      ? []
      : [
          {
            lineId: row.line.id,
            dishName: staffPresentationName(row.line),
            quantity: thousandthsToDecimal(remaining),
            released: isReleased({ ...row, sentAt: row.line.sentAt }),
          },
        ];
  });
}
