import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { centsToDecimal, decimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import {
  cashPayment,
  inTx,
  partyRevisionOf,
  paymentRows,
  provisionBillVenue,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// Pay for items on the card reader (A1515 D2): the items move to a bill of their own before the
// card is asked, and go back to the table's bill when it charges nothing.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

/** A table's bill holding a Caña (3.00) and a Tarta (18.00). */
const canaAndTarta = () => tabWith(venue, "Caña", "Tarta");

async function lineIdOf(billId: string, lineNo: number): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId)),
  ).then((rows) => [rows[lineNo - 1]]);
  return row!.id;
}

async function payTartaByReader(sourceId: string) {
  const [party] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, sourceId)),
  );
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${sourceId}/item-payments`, {
    submissionId: randomUUID(),
    picks: [{ lineId: await lineIdOf(sourceId, 2) }],
    partyId: party!.partyId,
    expectedPartyRevision: await partyRevisionOf(venue, sourceId),
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, sourceId))],
    method: "card",
    entry: "reader",
    applied: "18.00",
    tip: "0.00",
  });
}

/** Starts paying for the Tarta with the reader's collect held; answers the request, its release and
 * the new bill. */
async function heldTartaPayment(sourceId: string) {
  const release = venue.card.holdNextCollect();
  const calls = venue.card.collectCalls.length;
  const answer = payTartaByReader(sourceId);
  await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
  return { answer, release, newBill: await billNaming(sourceId) };
}

async function billNaming(sourceId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.itemsPaidFrom, sourceId)),
  );
  return row!.id;
}

async function lineTotals(billId: string): Promise<string[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ lineTotal: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  return rows.map(({ lineTotal }) => centsToDecimal(lineTotal));
}

async function invoiceCount(billId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return rows.length;
}

function balance(billId: string) {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

const settle = (cfg = venue.cfg) =>
  settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg,
  });

/** A card left pending by a reader that stopped answering, whose provider then said, unasked by a
 * person, that it charged nothing. */
async function stuckThenFailed(sourceId: string): Promise<{ newBill: string; paymentId: string }> {
  venue.card.stallNextCollect();
  const answer = await payTartaByReader(sourceId);
  expect(answer.json).toMatchObject({ payment: { outcome: "timeout" } });
  const newBill = await billNaming(sourceId);
  const [payment] = await paymentRows(venue, newBill);
  await inTx(venue, (tx) =>
    tx
      .update(payments)
      .set({
        state: "failed",
        resolvedBy: null,
        resolutionOutcome: "failed",
        resolutionCancelledAtProvider: true,
        resolutionProviderStatus: "canceled",
        resolvedAt: venue.clock.now().instant.toISOString(),
      })
      .where(eq(payments.billPaymentId, payment!.id)),
  );
  return { newBill, paymentId: payment!.id };
}

describe("A1515 pay for items on the card reader", () => {
  it("a captured card issues the new bill's ticket", async () => {
    const sourceId = await canaAndTarta();

    const paid = await payTartaByReader(sourceId);

    expect(paid.status).toBe(200);
    const newBill = paid.json.billId as string;
    expect(paid.json.payment).toMatchObject({
      outcome: "received",
      invoice: { total: "18.00" },
      balance: { workingOrderId: newBill, status: "settled" },
    });
    expect(await lineTotals(sourceId)).toEqual(["3.00"]);
    expect(await statusOf(venue, sourceId)).toBe("open");
    expect(await invoiceCount(newBill)).toBe(1);
  });

  it("a declined card puts the items back", async () => {
    const sourceId = await canaAndTarta();
    venue.card.failNextCollect();

    const paid = await payTartaByReader(sourceId);

    expect(paid.status).toBe(200);
    const newBill = paid.json.billId as string;
    expect(paid.json.payment).toMatchObject({
      outcome: "declined",
      payment: { state: "failed" },
    });
    expect(await lineTotals(sourceId)).toEqual(["3.00", "18.00"]);
    expect((await balance(sourceId)).json).toMatchObject({ total: "21.00", outstanding: "21.00" });
    expect(await statusOf(venue, newBill)).toBe("abandoned");
    expect(await lineTotals(newBill)).toEqual([]);
    expect(await invoiceCount(newBill)).toBe(0);
  });

  it("while the card is awaited the items are on the new bill", async () => {
    const sourceId = await canaAndTarta();
    const { answer, release, newBill } = await heldTartaPayment(sourceId);

    const during = await balance(sourceId);
    const [numbered] = await inTx(venue, (tx) =>
      tx
        .select({ billNumber: workingOrders.billNumber })
        .from(workingOrders)
        .where(eq(workingOrders.id, newBill)),
    );
    const write = inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, newBill, [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }]),
    );
    await expect(write).rejects.toMatchObject({ code: "order.payment_in_flight" });
    release();
    await answer;

    expect(during.json).toMatchObject({
      total: "3.00",
      beingPaidOn: { billId: newBill, billNumber: numbered!.billNumber },
    });
    expect((await balance(sourceId)).json).not.toHaveProperty("beingPaidOn");
  });

  it("a stuck card settled later as failed puts the items back", async () => {
    const sourceId = await canaAndTarta();
    const { newBill, paymentId } = await stuckThenFailed(sourceId);

    await settle();

    expect((await paymentRows(venue, newBill)).find((row) => row.id === paymentId)).toMatchObject({
      state: "failed",
    });
    expect(await lineTotals(sourceId)).toEqual(["3.00", "18.00"]);
    expect(await statusOf(venue, newBill)).toBe("abandoned");
    expect(await invoiceCount(newBill)).toBe(0);
  });

  it("a source no longer open keeps the items on their own bill", async () => {
    const sourceId = await canaAndTarta();
    const { answer, release, newBill } = await heldTartaPayment(sourceId);
    venue.card.failNextCollect();
    const paidSource = await cashPayment(venue, venue.cookie, sourceId, "3.00");
    expect(paidSource.status).toBe(200);
    release();
    const paid = await answer;

    expect(paid.json.payment).toMatchObject({ outcome: "declined" });
    expect(await statusOf(venue, sourceId)).toBe("settled");
    expect(await paymentRows(venue, newBill)).toMatchObject([{ state: "failed" }]);
    expect(await statusOf(venue, newBill)).toBe("open");
    expect(await lineTotals(newBill)).toEqual(["18.00"]);
  });

  it("a refused put-back still fails the payment", async () => {
    const sourceId = await canaAndTarta();
    const { newBill, paymentId } = await stuckThenFailed(sourceId);

    await settle({ ...venue.cfg, simplifiedInvoiceLimit: decimal("20.00") });

    expect((await paymentRows(venue, newBill)).find((row) => row.id === paymentId)).toMatchObject({
      state: "failed",
    });
    expect(await statusOf(venue, newBill)).toBe("open");
    expect(await lineTotals(newBill)).toEqual(["18.00"]);
    expect(await lineTotals(sourceId)).toEqual(["3.00"]);
  });
});
