import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect } from "vitest";
import { sales, workingOrderLines } from "@waitron/db";
import { thousandthsToDecimal } from "@waitron/shared";
import { invoiceRecords } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { readBillEditState } from "../bill-editing.js";
import { inTx, send, statusOf, type Answer } from "./bill-venue.js";
import type { OrderVenue } from "./order-venue.js";

/** The routes of Reopen to split's tests, and what they read back. */
type Party = { partyId: string };

export function revisionOf(venue: OrderVenue, partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

export function dishesOf(venue: OrderVenue, billId: string) {
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
  venue: OrderVenue,
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
  venue: OrderVenue,
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

export function split(
  venue: OrderVenue,
  billId: string,
  cookie = venue.supervisorTill,
  app: Hono = venue.app,
): Promise<Answer> {
  return send(app, cookie, "POST", `/api/working-orders/${billId}/split-after-print`, {});
}

export function creditsOf(venue: OrderVenue, saleId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.correctsSaleId, saleId)));
}

export async function invoiceOf(venue: OrderVenue, billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!;
}

/** Everything a split would write: the corrective and its record, the copied bill and dishes, and
 * which bill each payment is on. */
export function written(venue: OrderVenue) {
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
  venue: OrderVenue,
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
