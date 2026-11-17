import { eq, inArray, and } from "drizzle-orm";
import {
  invoiceDeliveries,
  orderGroups,
  ticketItems,
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
import { billOwes, checkAndBumpParty, readBillsOfParties, runServiceCommand } from "./parties.js";
import { enqueueOriginalReceipt, printerLookup } from "./receipt-print.js";
import { readIssuedSales } from "./sale-due.js";
import { serviceDishCondition } from "./service-dishes.js";
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
      const bill = (await readBillsOfParties(tx, [partyId]))
        .get(partyId)!
        .find((row) => row.workingOrderId === req.billId);
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
      await refuseBillPaymentInFlight(
        deps.db,
        tx,
        req.billId,
        bill.status === "open" ? "open" : "placed",
      );
      const printers = printerLookup(tx, cfg.origin);
      const paper = await needsPaper(tx, req.billId);
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
      if (!paper) await assertDeliveryQueued(tx, req.billId, saleId);
      if (bill.status === "open")
        await markOrderPlaced(tx, deps.clock, cfg, req.billId, operatorId, deps.attendance);
      if (decimalToCents(total) === 0) await settleIssuedOwingNothing(tx, deps, req.billId, saleId);
      if (paper)
        await enqueueOriginalReceipt(
          tx,
          cfg,
          await readSettledTicket(deps.backend, tx, cfg, req.billId),
          saleId,
          { printers, personId: operatorId },
        );
      return {
        revision,
        workingOrderId: req.billId,
        saleId,
        invoiceNumber: (await readInvoiceNumbers(tx, [saleId])).get(saleId)!,
        total,
        owed,
      };
    },
  );
}

/**
 * `issueUnpaidInvoice` reserves a staged A4 or email delivery as an optional document, so a
 * destination switched off since staging, or a reservation that failed, still issues. Printing the
 * bill exists to put it in front of the guest, so here either refuses and the issue rolls back.
 */
async function assertDeliveryQueued(tx: Transaction, billId: string, saleId: string) {
  const [order] = await tx
    .select({ delivery: workingOrders.invoiceDelivery })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
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
      medium: order!.delivery!.medium as "a4" | "email",
    });
}

/** A full invoice staged for A4 or email has its delivery reserved by `issueUnpaidInvoice`. */
async function needsPaper(tx: Transaction, billId: string): Promise<boolean> {
  const [order] = await tx
    .select({ invoiceType: workingOrders.invoiceType, delivery: workingOrders.invoiceDelivery })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const medium = order!.delivery?.medium;
  return order!.invoiceType !== "F1" || (medium !== "a4" && medium !== "email");
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
        await serviceDishCondition(tx, inArray(workingOrderLines.workingOrderId, [billId])),
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
