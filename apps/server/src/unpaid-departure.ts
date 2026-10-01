import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  diningTables,
  invoiceSeries,
  nowIso,
  parties,
  partyTables,
  saleSettlements,
  saleVoids,
  sales,
  unpaidDepartures,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import type { TrustedClock, FiscalBackend } from "@waitron/fiscal";
import { authorize, persons } from "@waitron/identity";
import type { Override, PinAttempts } from "@waitron/identity";
import { AppError, centsToDecimal, decimalToCents } from "@waitron/shared";
import type { TillId } from "@waitron/shared";
import { billOwes, checkAndBumpParty, closeParty, readBillsOfParties } from "./parties.js";
import { readIssuedSales } from "./sale-due.js";
import type { TillConfig } from "./till-config.js";
import {
  holdsUnreleasedDish,
  issueUnpaidInvoice,
  markOrderPlaced,
  readInvoiceNumber,
  refusePaymentInFlight,
  unsentDishLines,
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
 * The party's guests left without paying: every bill of its family still to pay is invoiced in full
 * and left unpaid, one `unpaid_departures` row records each with the reason and who authorised it,
 * and the party then closes as Finish table closes it ({@link closeParty}). Needs
 * `sale.unpaid_departure` from the operator or the override.
 *
 * An open bill is invoiced now, as an invoice-first placing invoices it, without a receipt; a
 * presented bill keeps the invoice it has, and one presented without an invoice is invoiced now.
 * Refused, writing nothing: `unpaid_departure.nothing_outstanding` when no bill is owed,
 * `unpaid_departure.unfired_dishes` for an open bill holding a dish the kitchen was never told to
 * make (never sent, or held), and
 * `unpaid_departure.bill_part_paid` for an open bill holding a payment. A retry after the party has
 * closed is `party.not_open`, as it is for Finish.
 */
export async function recordUnpaidDeparture(
  tx: Transaction,
  deps: { backend: FiscalBackend; clock: TrustedClock },
  cfg: TillConfig,
  saleTillId: TillId,
  partyId: string,
  req: UnpaidDepartureRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
): Promise<{ state: "closed"; departures: RecordedDeparture[] }> {
  const { authorizedBy } = await authorize(
    tx,
    { sessionId: operator.sessionId, permission: "sale.unpaid_departure", override: req.override },
    operator.attempts,
  );
  await checkAndBumpParty(tx, partyId, req.expectedPartyRevision, "open");

  const bills = (await readBillsOfParties(tx, [partyId])).get(partyId)!;
  const owing = bills.filter(billOwes);
  if (owing.length === 0) {
    throw new AppError("unpaid_departure.nothing_outstanding", { partyId });
  }
  const open = owing.filter((bill) => bill.status === "open");
  for (const bill of open) {
    if (
      (await unsentDishLines(tx, bill.workingOrderId)).length > 0 ||
      (await holdsUnreleasedDish(tx, bill.workingOrderId))
    ) {
      throw new AppError("unpaid_departure.unfired_dishes", {
        workingOrderId: bill.workingOrderId,
      });
    }
    if (bill.hasPayments) {
      throw new AppError("unpaid_departure.bill_part_paid", {
        workingOrderId: bill.workingOrderId,
      });
    }
  }
  // What is left of the in-flight check once no bill holds a payment: a card at the reader for a
  // whole bill, which marks the bill rather than writing a payment of it.
  await refusePaymentInFlight(
    tx,
    open.map((bill) => bill.workingOrderId),
  );

  const owingIds = owing.map((bill) => bill.workingOrderId);
  const invoiced = await readIssuedSales(tx, owingIds);
  for (const bill of owing) {
    if (invoiced.has(bill.workingOrderId)) continue;
    const { ticket } = await issueUnpaidInvoice(
      tx,
      deps,
      cfg,
      bill.workingOrderId,
      operator.personId,
      saleTillId,
    );
    if (bill.status === "open") {
      await markOrderPlaced(
        tx,
        deps.clock,
        cfg,
        bill.workingOrderId,
        operator.personId,
        ticket.orderLabel,
      );
    }
  }

  const due = await readIssuedSales(tx, owingIds);
  const recordedAt = nowIso();
  const departures: RecordedDeparture[] = [];
  for (const workingOrderId of owingIds) {
    const { saleId, amountDue } = due.get(workingOrderId)!;
    const [row] = await tx
      .insert(unpaidDepartures)
      .values({
        partyId,
        workingOrderId,
        saleId,
        amount: decimalToCents(amountDue),
        reason: req.reason,
        recordedBy: operator.personId,
        authorizedBy,
        tillId: saleTillId,
        recordedAt,
      })
      .returning({ id: unpaidDepartures.id });
    departures.push({
      id: row!.id,
      workingOrderId,
      saleId,
      invoiceNumber: await readInvoiceNumber(tx, saleId),
      amount: amountDue,
    });
  }

  const empty = bills
    .filter((bill) => bill.status === "open" && bill.lines === 0)
    .map((bill) => bill.workingOrderId);
  const closed = await closeParty(tx, partyId, empty, operator.personId);
  return { ...closed, departures };
}

/** One unpaid departure whose invoice is still owed, as the till lists it. */
export interface UnpaidDepartureView {
  id: string;
  workingOrderId: string;
  billLabel: string | null;
  /** The tables the party held when it left, in the order they joined it. */
  tableLabels: string[];
  saleId: string;
  invoiceNumber: string;
  amount: string;
  reason: string;
  recordedByName: string | null;
  authorizedByName: string | null;
  recordedAt: string;
}

/**
 * The unpaid departures whose invoice is neither settled nor voided, newest first. An invoice a
 * full invoice has since substituted stays listed: `listOutstandingSales`
 * (packages/core/src/list-outstanding-sales.ts) likewise leaves out only the substitute.
 */
export async function listUnpaidDepartures(tx: Transaction): Promise<UnpaidDepartureView[]> {
  const recorder = alias(persons, "recorder");
  const authorizer = alias(persons, "authorizer");
  const rows = await tx
    .select({
      id: unpaidDepartures.id,
      partyId: unpaidDepartures.partyId,
      workingOrderId: unpaidDepartures.workingOrderId,
      billLabel: workingOrders.label,
      saleId: unpaidDepartures.saleId,
      seriesCode: invoiceSeries.code,
      invoiceNumber: sales.invoiceNumber,
      amount: unpaidDepartures.amount,
      reason: unpaidDepartures.reason,
      recordedByName: recorder.displayName,
      authorizedByName: authorizer.displayName,
      recordedAt: unpaidDepartures.recordedAt,
    })
    .from(unpaidDepartures)
    .innerJoin(workingOrders, eq(workingOrders.id, unpaidDepartures.workingOrderId))
    .innerJoin(sales, eq(sales.id, unpaidDepartures.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .leftJoin(saleSettlements, eq(saleSettlements.saleId, unpaidDepartures.saleId))
    .leftJoin(saleVoids, eq(saleVoids.saleId, unpaidDepartures.saleId))
    .leftJoin(recorder, eq(recorder.id, unpaidDepartures.recordedBy))
    .leftJoin(authorizer, eq(authorizer.id, unpaidDepartures.authorizedBy))
    .where(and(isNull(saleSettlements.id), isNull(saleVoids.id)))
    .orderBy(desc(unpaidDepartures.recordedAt), desc(sql`${unpaidDepartures}.rowid`));

  const partyIds = [...new Set(rows.map((row) => row.partyId))];
  const tables = await tx
    .select({ partyId: partyTables.partyId, label: diningTables.label })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .where(and(inArray(partyTables.partyId, partyIds), eq(partyTables.leftAt, parties.closedAt)))
    .orderBy(partyTables.joinedAt, partyTables.id);
  const tablesOf = new Map(partyIds.map((id) => [id, [] as string[]]));
  for (const table of tables) tablesOf.get(table.partyId)!.push(table.label);

  return rows.map((row) => ({
    id: row.id,
    workingOrderId: row.workingOrderId,
    billLabel: row.billLabel,
    tableLabels: tablesOf.get(row.partyId)!,
    saleId: row.saleId,
    invoiceNumber: formatInvoiceNumber(row.seriesCode, row.invoiceNumber),
    amount: centsToDecimal(row.amount),
    reason: row.reason,
    recordedByName: row.recordedByName,
    authorizedByName: row.authorizedByName,
    recordedAt: row.recordedAt,
  }));
}
