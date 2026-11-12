import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { clearBillRequestIfPaid } from "./bill-request.js";
import { captureKitchenActivity } from "./attendance-capture.js";
import { and, inArray, isNull } from "drizzle-orm";
import {
  lineServiceCancellations,
  nowIso,
  ticketItems,
  unpaidDepartures,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { TrustedClock, FiscalBackend } from "@waitron/fiscal";
import { authorize } from "@waitron/identity";
import type { Override, PinAttempts } from "@waitron/identity";
import { AppError, decimalToCents } from "@waitron/shared";
import type { Decimal, DeviceId, SaleId } from "@waitron/shared";
import {
  billOwes,
  checkAndBumpParty,
  closeParty,
  handOverFinishedBills,
  readBillsOfParties,
} from "./parties.js";
import { parseBillEditExpecteds, requireBillEditors } from "./bill-editing.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { readPartyFinishReadiness } from "./finish-party-service.js";
import type { BillEditExpected } from "./order-drafts.js";
import { readIssuedSales } from "./sale-due.js";
import type { Logger } from "./logger.js";
import { pinnedAt } from "./issue-moment.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { refusePlacedPaymentInFlight, settleIssuedOwingNothing } from "./till-sale.js";
import {
  issueUnpaidInvoice,
  markOrderPlaced,
  ordersWithUnfiredDish,
  priceForIssuance,
  readInvoiceNumbers,
  refusePaymentInFlight,
} from "./working-order.js";
import "./errors.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { isStarted } from "./kitchen-print.js";
import {
  serviceCancellationFamilies,
  enqueueServiceCancellation,
  writeServiceCancellations,
} from "./line-service-cancel.js";

export interface UnpaidDepartureRequest {
  billId: string;
  expectedPartyRevision: number;
  expectedEdits: BillEditExpected[];
  /** Trimmed, 1 to 500 characters. */
  reason: string;
  override?: Override;
}

/** One bill left unpaid, as the departure answers it. */
export interface RecordedDeparture {
  id: string;
  workingOrderId: string;
  saleId: string;
  invoiceNumber: string;
  amount: string;
}

export async function recordUnpaidDeparture(
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
  req: UnpaidDepartureRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
): Promise<{ state: "open" | "closed"; departures: RecordedDeparture[] }> {
  await requireEconomicWrite(tx, cfg, deps.admission);
  const { authorizedBy } = await authorize(
    tx,
    { sessionId: operator.sessionId, permission: "sale.void", override: req.override },
    operator.attempts,
  );
  const reading = deps.clock.now();
  await deps.backend.refuseWhileClockBehind(tx, reading);
  await checkAndBumpParty(tx, partyId, req.expectedPartyRevision, "open");
  const bills = (await readBillsOfParties(tx, [partyId])).get(partyId)!;
  const bill = bills.find((row) => row.workingOrderId === req.billId);
  if (bill === undefined || !billOwes(bill))
    throw new AppError("unpaid_departure.nothing_outstanding", { partyId });
  const expectedEdits = parseBillEditExpecteds(req.expectedEdits);
  await requireBillEditors(
    tx,
    [req.billId],
    operator.personId,
    expectedEdits.filter((edit) => edit.billId === req.billId),
  );
  await assertBillHasNoUnsent(tx, req.billId);
  const issued = (await readIssuedSales(tx, [req.billId])).get(req.billId);
  if (issued === undefined) {
    if ((await ordersWithUnfiredDish(tx, [req.billId])).has(req.billId))
      throw new AppError("unpaid_departure.unfired_dishes", { workingOrderId: req.billId });
    if (bill.hasPayments)
      throw new AppError("unpaid_departure.bill_holds_payment", { workingOrderId: req.billId });
  }
  if (bill.status === "open") await refusePaymentInFlight(tx, [req.billId]);
  else await refusePlacedPaymentInFlight(deps.db, tx, [req.billId]);

  let saleId = issued?.saleId;
  let due = issued?.amountDue;
  if (issued === undefined) {
    const invoice = await priceForIssuance(
      tx,
      pinnedAt(deps.clock, reading),
      deps.backend,
      cfg,
      req.billId,
    );
    const recorded = await issueUnpaidInvoice(
      tx,
      deps.backend,
      cfg,
      invoice,
      operator.personId,
      deps.admission,
      deps.log,
    );
    saleId = recorded.saleId;
    due = invoice.priced.total;
    if (bill.status === "open")
      await markOrderPlaced(tx, deps.clock, cfg, req.billId, operator.personId, deps.attendance);
  }
  const departures =
    decimalToCents(due!) === 0
      ? []
      : await insertDeparture(tx, req.billId, saleId!, due!, {
          partyId,
          reason: req.reason,
          recordedBy: operator.personId,
          authorizedBy,
          source: cfg.origin.source,
          deviceId: cfg.origin.deviceId,
        });
  if (decimalToCents(due!) === 0) await settleIssuedOwingNothing(tx, deps, req.billId, saleId!);
  const stopped = await stopDepartureKitchen(tx, cfg, [req.billId], operator.personId);
  await captureKitchenActivity(
    tx,
    deps.attendance === undefined ? undefined : { recorder: deps.attendance, clock: deps.clock },
    operator.personId,
    bill.status === "open"
      ? []
      : [...new Set([...departures.map((row) => row.workingOrderId), ...stopped.cancelledBillIds])],
    `unpaid-departure:${partyId}:${req.expectedPartyRevision}`,
  );
  // Service stops when the bill departs, even while other guests keep the table.
  await tx
    .update(workingOrders)
    .set({ collectedAt: nowIso() })
    .where(
      and(inArray(workingOrders.id, stopped.kitchenBillIds), isNull(workingOrders.collectedAt)),
    );
  await clearBillRequestIfPaid(tx, req.billId, deps.log);
  const readiness = await readPartyFinishReadiness(tx, {
    partyId,
    expectedPartyRevision: req.expectedPartyRevision + 1,
    operatorId: operator.personId,
    expectedEdits,
  });
  if (!readiness.ready) return { state: "open", departures };
  const closed = await closeParty(
    tx,
    partyId,
    bills
      .filter((row) => row.status === "open" && row.lines === 0)
      .map((row) => row.workingOrderId),
    operator.personId,
    deps.attendance === undefined ? undefined : { recorder: deps.attendance },
    expectedEdits,
  );
  await handOverFinishedBills(tx, partyId);
  return { ...closed, departures };
}

async function stopDepartureKitchen(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  billIds: string[],
  operatorId: string,
): Promise<{ kitchenBillIds: string[]; cancelledBillIds: string[] }> {
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(
      and(
        inArray(workingOrders.id, billIds),
        inArray(workingOrders.status, ["placed", "settled"]),
        isNull(workingOrders.collectedAt),
      ),
    );
  const ids = bills.map((bill) => bill.id);
  const tickets = await tx
    .select()
    .from(ticketItems)
    .where(inArray(ticketItems.workingOrderId, ids));
  const remote = new Set(
    tickets.filter((item) => !item.madeHere).map((item) => item.workingOrderLineId),
  );
  const kitchenBillIds = [
    ...new Set(tickets.filter((item) => !item.madeHere).map((item) => item.workingOrderId)),
  ];
  const rows = await tx
    .select()
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.workingOrderId, kitchenBillIds));
  const dishes = rows.filter((row) => row.parentLineId === null);
  const priors = await tx
    .select()
    .from(lineServiceCancellations)
    .where(
      inArray(
        lineServiceCancellations.lineId,
        dishes.map((row) => row.id),
      ),
    );
  const work = await dishKitchenItems(
    tx,
    dishes.map((row) => row.id),
  );
  const taken = dishes.flatMap((dish) => {
    const off =
      dish.quantity -
      dish.servedQuantity -
      (priors.find((row) => row.lineId === dish.id)?.quantity ?? 0);
    return off > 0 &&
      (work.get(dish.id) ?? []).some(
        (item) => remote.has(item.workingOrderLineId) && item.firedAt !== null,
      )
      ? [{ dish, off }]
      : [];
  });
  const families = serviceCancellationFamilies(rows, taken, priors);
  const cancelledBillIds = [...new Set(taken.map(({ dish }) => dish.workingOrderId))];
  for (const billId of cancelledBillIds) {
    const selected = families.filter(({ dish }) => dish.workingOrderId === billId);
    await enqueueServiceCancellation(tx, cfg, billId, selected, work);
    for (const family of selected)
      await writeServiceCancellations(
        tx,
        [family],
        operatorId,
        (work.get(family.dish.id) ?? []).some(
          (item) => remote.has(item.workingOrderLineId) && isStarted(item.state),
        ),
      );
  }
  return { kitchenBillIds, cancelledBillIds };
}

async function insertDeparture(
  tx: Transaction,
  workingOrderId: string,
  saleId: SaleId,
  amount: Decimal,
  common: {
    partyId: string;
    reason: string;
    recordedBy: string;
    authorizedBy: string;
    source: "device";
    deviceId: DeviceId;
  },
): Promise<RecordedDeparture[]> {
  const numbers = await readInvoiceNumbers(tx, [saleId]);
  const [row] = await tx
    .insert(unpaidDepartures)
    .values({
      ...common,
      workingOrderId,
      saleId,
      amount: decimalToCents(amount),
      recordedAt: nowIso(),
    })
    .returning({ id: unpaidDepartures.id });
  return [{ id: row!.id, workingOrderId, saleId, invoiceNumber: numbers.get(saleId)!, amount }];
}
