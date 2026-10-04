import { nowIso, unpaidDepartures } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TrustedClock, FiscalBackend } from "@waitron/fiscal";
import { authorize } from "@waitron/identity";
import type { Override, PinAttempts } from "@waitron/identity";
import { AppError, decimalToCents } from "@waitron/shared";
import type { Decimal, DeviceId, SaleId } from "@waitron/shared";
import { billOwes, checkAndBumpParty, closeParty, readBillsOfParties } from "./parties.js";
import { readIssuedSales } from "./sale-due.js";
import type { Logger } from "./logger.js";
import type { DeviceRequestConfig } from "./till-config.js";
import { settleIssuedOwingNothing } from "./till-sale.js";
import {
  issueUnpaidInvoice,
  markOrderPlaced,
  ordersWithUnfiredDish,
  priceForIssuance,
  readInvoiceNumbers,
  refusePaymentInFlight,
} from "./working-order.js";
import "./errors.js";

export interface UnpaidDepartureRequest {
  expectedPartyRevision: number;
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

/**
 * The party's guests left without paying: each invoice of its family's bills still to pay that
 * still owes something gets one `unpaid_departures` row with the reason, who recorded it and who
 * authorised it, and the party then closes as Finish table closes it ({@link closeParty}). Needs
 * `sale.void` from the operator or the override.
 *
 * An open bill is invoiced now, as an invoice-first placing invoices it, without a receipt; a
 * presented bill keeps the invoice it has, and one presented without an invoice is invoiced now.
 * A bill owing nothing once invoiced (its credit notes cancel its invoice, or every line was given
 * away) gets no row and is settled as collecting it settles it ({@link settleIssuedOwingNothing}),
 * so the party closes with no departure rows when every bill owes nothing (why: the B17 entry in
 * docs/backlog.md).
 *
 * Refused, writing nothing: `unpaid_departure.nothing_outstanding` when no bill is still to pay
 * ({@link billOwes}), which is no bill Finish table refuses as unpaid,
 * `unpaid_departure.unfired_dishes` for a bill to be invoiced holding a dish the kitchen is not
 * making ({@link ordersWithUnfiredDish}: never sent, held, or recalled), and
 * `unpaid_departure.bill_holds_payment` for an open bill holding a payment, one given back in full
 * included. A retry after the party has closed is `party.not_open`, as it is for Finish.
 */
export async function recordUnpaidDeparture(
  tx: Transaction,
  deps: { backend: FiscalBackend; clock: TrustedClock; log?: Logger },
  cfg: DeviceRequestConfig,
  partyId: string,
  req: UnpaidDepartureRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
): Promise<{ state: "closed"; departures: RecordedDeparture[] }> {
  const { authorizedBy } = await authorize(
    tx,
    { sessionId: operator.sessionId, permission: "sale.void", override: req.override },
    operator.attempts,
  );
  await checkAndBumpParty(tx, partyId, req.expectedPartyRevision, "open");

  const bills = (await readBillsOfParties(tx, [partyId])).get(partyId)!;
  const owing = bills.filter(billOwes);
  if (owing.length === 0) {
    throw new AppError("unpaid_departure.nothing_outstanding", { partyId });
  }
  const owingIds = owing.map((bill) => bill.workingOrderId);
  const invoiced = await readIssuedSales(tx, owingIds);
  const toInvoice = owing.filter((bill) => !invoiced.has(bill.workingOrderId));
  const unfired = await ordersWithUnfiredDish(
    tx,
    toInvoice.map((bill) => bill.workingOrderId),
  );
  const firstUnfired = toInvoice.find((bill) => unfired.has(bill.workingOrderId));
  if (firstUnfired !== undefined) {
    throw new AppError("unpaid_departure.unfired_dishes", {
      workingOrderId: firstUnfired.workingOrderId,
    });
  }
  const open = owing.filter((bill) => bill.status === "open");
  const openIds = new Set(open.map((bill) => bill.workingOrderId));
  const holding = open.find((bill) => bill.hasPayments);
  if (holding !== undefined) {
    throw new AppError("unpaid_departure.bill_holds_payment", {
      workingOrderId: holding.workingOrderId,
    });
  }
  // What is left of the in-flight check once no bill holds a payment: a card at the reader for a
  // whole bill, which marks the bill rather than writing a payment of it.
  await refusePaymentInFlight(tx, [...openIds]);

  const invoices = [];
  for (const bill of toInvoice) {
    invoices.push(await priceForIssuance(tx, deps.clock, cfg, bill.workingOrderId));
  }
  const due = new Map<string, Decimal>([
    ...[...invoiced].map(([id, sale]) => [id, sale.amountDue] as const),
    ...invoices.map((invoice) => [invoice.id, invoice.priced.total] as const),
  ]);
  const departing = owingIds.filter((id) => decimalToCents(due.get(id)!) > 0);

  const saleOf = new Map<string, SaleId>([...invoiced].map(([id, sale]) => [id, sale.saleId]));
  for (const invoice of invoices) {
    const { saleId } = await issueUnpaidInvoice(tx, deps.backend, cfg, invoice, operator.personId);
    saleOf.set(invoice.id, saleId);
    if (openIds.has(invoice.id)) {
      await markOrderPlaced(tx, deps.clock, cfg, invoice.id, operator.personId);
    }
  }
  for (const id of owingIds) {
    if (decimalToCents(due.get(id)!) === 0) {
      await settleIssuedOwingNothing(tx, deps, id, saleOf.get(id)!);
    }
  }

  const departures =
    departing.length === 0
      ? []
      : await insertDepartures(tx, departing, saleOf, due, {
          partyId,
          reason: req.reason,
          recordedBy: operator.personId,
          authorizedBy,
          source: cfg.origin.source,
          deviceId: cfg.origin.deviceId,
        });

  const empty = bills
    .filter((bill) => bill.status === "open" && bill.lines === 0)
    .map((bill) => bill.workingOrderId);
  const closed = await closeParty(tx, partyId, empty, operator.personId);
  return { ...closed, departures };
}

/** One `unpaid_departures` row for each of `departing`, at what its invoice owes in `due`. */
async function insertDepartures(
  tx: Transaction,
  departing: readonly string[],
  saleOf: ReadonlyMap<string, SaleId>,
  due: ReadonlyMap<string, Decimal>,
  common: {
    partyId: string;
    reason: string;
    recordedBy: string;
    authorizedBy: string;
    source: "device";
    deviceId: DeviceId;
  },
): Promise<RecordedDeparture[]> {
  const numbers = await readInvoiceNumbers(
    tx,
    departing.map((id) => saleOf.get(id)!),
  );
  const recordedAt = nowIso();
  const rows = await tx
    .insert(unpaidDepartures)
    .values(
      departing.map((workingOrderId) => ({
        ...common,
        workingOrderId,
        saleId: saleOf.get(workingOrderId)!,
        amount: decimalToCents(due.get(workingOrderId)!),
        recordedAt,
      })),
    )
    .returning({ id: unpaidDepartures.id, workingOrderId: unpaidDepartures.workingOrderId });
  const idOf = new Map(rows.map((row) => [row.workingOrderId, row.id]));
  return departing.map((workingOrderId): RecordedDeparture => {
    const saleId = saleOf.get(workingOrderId)!;
    return {
      id: idOf.get(workingOrderId)!,
      workingOrderId,
      saleId,
      invoiceNumber: numbers.get(saleId)!,
      amount: due.get(workingOrderId)!,
    };
  });
}
