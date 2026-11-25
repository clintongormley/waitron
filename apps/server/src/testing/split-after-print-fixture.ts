import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect } from "vitest";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { thousandthsToDecimal } from "@waitron/shared";
import { invoiceRecords } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { readBillEditState } from "../bill-editing.js";
import { inTx, send, statusOf, type Answer, type BillVenue } from "./bill-venue.js";

type Party = { partyId: string };

export function revisionOf(venue: BillVenue, partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

export function dishesOf(venue: BillVenue, billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
}

/** Marks the named dishes of the bill served, every dish when none is named. */
export async function serve(
  venue: BillVenue,
  party: Party,
  billId: string,
  ...names: string[]
): Promise<Answer> {
  const dishes = (await dishesOf(venue, billId)).filter(
    (line) => line.parentLineId === null && (names.length === 0 || names.includes(line.name)),
  );
  return send(venue.app, venue.cookie, "POST", `/api/parties/${party.partyId}/served`, {
    submissionId: randomUUID(),
    expectedPartyRevision: revisionOf(venue, party.partyId),
    items: dishes.map((line) => ({
      lineId: line.id,
      quantity: thousandthsToDecimal(line.quantity),
    })),
  });
}

/** Print the bill on the first till, which has a receipt printer. */
export async function printBill(
  venue: BillVenue,
  party: Party,
  billId: string,
  printAnyway = false,
): Promise<Answer> {
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, billId),
  );
  return send(venue.app, venue.cookie, "POST", `/api/parties/${party.partyId}/end-meal`, {
    billId,
    expectedPartyRevision: revisionOf(venue, party.partyId),
    expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
    submissionId: randomUUID(),
    ...(printAnyway ? { printAnyway: true } : {}),
  });
}

/** The party's dishes served, unless the bill was reopened, whose copies are served already, and
 * its bill printed. */
export async function printed<P extends Party & { tabId: string }>(
  venue: BillVenue,
  party: P,
): Promise<P> {
  const [bill] = await inTx(venue, (tx) =>
    tx
      .select({ reopenedFrom: workingOrders.reopenedFrom })
      .from(workingOrders)
      .where(eq(workingOrders.id, party.tabId)),
  );
  if (bill!.reopenedFrom === null) {
    const served = await serve(venue, party, party.tabId);
    expect(served.status, JSON.stringify(served.json)).toBe(200);
  }
  const ticket = await printBill(venue, party, party.tabId);
  expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
  return party;
}

/** Pays `amount` of the bill in cash, on the payer's own receipt when `ownReceipt`; the payment's
 * id. */
export async function payInCash(
  venue: BillVenue,
  billId: string,
  amount: string,
  ownReceipt = false,
): Promise<string> {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
      ...(ownReceipt ? { ownReceipt: true } : {}),
    },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  return (paid.json.payment as { id: string }).id;
}

export function balanceOf(venue: BillVenue, billId: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

export function split(
  venue: BillVenue,
  billId: string,
  cookie: string,
  app: Hono = venue.app,
  body: Record<string, unknown> = {},
): Promise<Answer> {
  return send(app, cookie, "POST", `/api/working-orders/${billId}/split-after-print`, body);
}

export function creditsOf(venue: BillVenue, saleId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.correctsSaleId, saleId)));
}

export async function invoiceOf(venue: BillVenue, billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!;
}

/** Everything a split would write: the corrective and its record, the copied bill and dishes, and
 * which bill each payment is on. */
export function written(venue: BillVenue) {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from ${invoiceRecords}) as records,
      (select count(*) from working_orders) as bills,
      (select count(*) from working_order_lines) as lines,
      (select count(*) from order_amendments) as amendments,
      (select group_concat(id || ':' || (select coalesce(max(sales.invoice_number), 0) + 1 from sales where sales.series_id = invoice_series.id), ',') from invoice_series) as series,
      (select group_concat(id || ':' || working_order_id, ',') from bill_payments) as payments
  `)[0];
}

/** Runs `answer`, expecting `refusal`, nothing written and the bill still printed. */
export async function expectRefused(
  venue: BillVenue,
  billId: string,
  answer: () => Promise<Answer>,
  refusal: { status: number; code: string },
): Promise<Answer> {
  const before = written(venue);
  const answered = await answer();
  expect({ status: answered.status, code: answered.json.code }).toEqual(refusal);
  expect(written(venue)).toEqual(before);
  expect(await statusOf(venue, billId)).toBe("placed");
  return answered;
}
