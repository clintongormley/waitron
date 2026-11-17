import { eq, inArray, and } from "drizzle-orm";
import { orderGroups, ticketItems, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { staffPresentationName } from "@waitron/menu";
import { AppError, decimalToCents, thousandthsToDecimal } from "@waitron/shared";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { parseBillEditExpecteds, requireBillEditors } from "./bill-editing.js";
import { stillOwedOnIssuedBill } from "./bill-payments.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { pinnedAt } from "./issue-moment.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import type { Logger } from "./logger.js";
import type { BillEditExpected } from "./order-drafts.js";
import { checkAndBumpParty, readBillsOfParties, runServiceCommand } from "./parties.js";
import { readIssuedSales } from "./sale-due.js";
import { serviceDishCondition } from "./service-dishes.js";
import { refuseBillPaymentInFlight, settleIssuedOwingNothing } from "./till-sale.js";
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
 * seated. A bill already holding a ticket is refused, so a bill is never issued twice.
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
): Promise<EndedMeal> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  const reading = deps.clock.now();
  await deps.backend.refuseUntilRecordable(tx, reading);
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    req.submissionId,
    "party.end_meal",
    { partyId, billId: req.billId, printAnyway: req.printAnyway, operatorId },
    async () => {
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
      await refuseBillPaymentInFlight(
        deps.db,
        tx,
        req.billId,
        bill.status === "open" ? "open" : "placed",
      );
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
        throw new AppError("unpaid_departure.nothing_outstanding", { partyId });
      const { saleId } = await issueUnpaidInvoice(
        tx,
        deps.backend,
        cfg,
        invoice,
        operatorId,
        deps.admission,
        deps.log,
      );
      if (bill.status === "open")
        await markOrderPlaced(tx, deps.clock, cfg, req.billId, operatorId, deps.attendance);
      if (decimalToCents(total) === 0) await settleIssuedOwingNothing(tx, deps, req.billId, saleId);
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
            name: staffPresentationName(row.line),
            quantity: thousandthsToDecimal(remaining),
            released: isReleased({ ...row, sentAt: row.line.sentAt }),
          },
        ];
  });
}
