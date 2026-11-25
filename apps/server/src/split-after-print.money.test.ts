import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPayments, refunds, tenders } from "@waitron/db";
import { insertCapturedPayment, listReconcilable, payments } from "@waitron/payments";
import {
  centsToDecimal,
  saleId as brandSaleId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { readReceiptPayments } from "./receipt-payments.js";
import { readTenderBlock } from "./till-sale.js";
import { billRefundFields, seedPendingCardPayment } from "./testing/bill-payment-fixture.js";
import {
  cashPayment,
  inTx,
  paymentRows,
  seatedWith,
  send,
  statusOf,
  type Answer,
} from "./testing/bill-venue.js";
import { provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

let venue: OrderVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, (tx) => offerProducts(tx, { zone: "tables" }));
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
  },
});

type Party = { partyId: string; tabId: string };

/** A party's dishes, served and printed. */
async function printed(...names: string[]): Promise<Party> {
  const party = await seatedWith(venue, ...names);
  const served = await fixture.serve(venue, party, party.tabId);
  expect(served.status, JSON.stringify(served.json)).toBe(200);
  const ticket = await fixture.printBill(venue, party, party.tabId);
  expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
  return party;
}

/** Reopen to split by an operator who does not hold `sale.rectify`. */
const split = (billId: string) => fixture.split(venue, billId, venue.cookie);
const invoiceOf = (billId: string) => fixture.invoiceOf(venue, billId);
const creditsOf = (saleId: string) => fixture.creditsOf(venue, saleId);

function pay(billId: string, body: Record<string, unknown>): Promise<Answer> {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    method: "cash",
    tip: "0.00",
    ...body,
  });
}

async function payInCash(billId: string, amount: string): Promise<string> {
  const paid = await pay(billId, {
    kind: "contribution",
    amount,
    tendered: amount,
    applied: amount,
  });
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  return (paid.json.payment as { id: string }).id;
}

function balanceOf(billId: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

/** The split refused with `code`: nothing written, the bill still printed, its ticket uncredited. */
async function refused(billId: string, code: string): Promise<void> {
  const answered = await fixture.expectRefused(venue, billId, () => split(billId), {
    status: 409,
    code,
  });
  expect(answered.json.params).toEqual({ workingOrderId: billId });
  expect(await creditsOf((await invoiceOf(billId)).id)).toEqual([]);
}

describe("Reopen to split on a part-paid printed bill", () => {
  it("a part-paid printed bill splits, and its cash counts towards the new bill", async () => {
    const party = await printed("Red wine bottle");
    const original = await invoiceOf(party.tabId);
    expect(original.total).toBe(3000);
    const paymentId = await payInCash(party.tabId, "10.00");

    const answer = await split(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const newBill = answer.json.billId as string;
    const balance = await balanceOf(newBill);
    expect(balance.status).toBe(200);
    expect(balance.json).toMatchObject({
      status: "open",
      total: "30.00",
      received: "10.00",
      outstanding: "20.00",
      payments: [expect.objectContaining({ id: paymentId, applied: "10.00", state: "received" })],
    });
    expect(await paymentRows(venue, party.tabId)).toEqual([]);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    expect((await creditsOf(original.id)).map((credit) => credit.total)).toEqual([-3000]);
  });

  it("the new bill's ticket takes the carried money as its tender", async () => {
    const party = await printed("Red wine bottle");
    const original = await invoiceOf(party.tabId);
    const carried = await payInCash(party.tabId, "10.00");
    const answer = await split(party.tabId);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const newBill = answer.json.billId as string;

    const rest = await cashPayment(venue, venue.cookie, newBill, "20.00");

    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(await statusOf(venue, newBill)).toBe("settled");
    const ticket = await invoiceOf(newBill);
    expect(ticket.total).toBe(3000);
    const tendersOf = (saleId: string) =>
      inTx(venue, (tx) =>
        tx
          .select({ billPaymentId: tenders.billPaymentId, amount: tenders.amount })
          .from(tenders)
          .where(eq(tenders.saleId, saleId))
          .orderBy(sql`${tenders}.rowid`),
      );
    const taken = await tendersOf(ticket.id);
    expect(taken.map((row) => row.amount)).toEqual([1000, 2000]);
    // In the order the tenders were written: the carried payment first.
    expect(taken.map((row) => row.billPaymentId)).toEqual([
      carried,
      (rest.json.payment as { id: string }).id,
    ]);
    expect(await tendersOf(original.id)).toEqual([]);
    const [creditNote] = await creditsOf(original.id);
    expect(original.total + creditNote!.total).toBe(0);
  });

  it("the credited ticket reprints without the carried payments", async () => {
    const party = await printed("Red wine bottle");
    const original = await invoiceOf(party.tabId);
    await payInCash(party.tabId, "10.00");
    const listed = () =>
      inTx(venue, (tx) => readReceiptPayments(tx, brandSaleId(original.id), party.tabId, false));
    expect((await listed()).payments).toEqual([expect.objectContaining({ amount: "10.00" })]);

    expect((await split(party.tabId)).status).toBe(200);

    expect((await listed()).payments).toBeUndefined();
  });

  it("a failed payment stays with the printed bill", async () => {
    const party = await printed("Red wine bottle");
    const [failed] = await inTx(venue, (tx) =>
      tx
        .insert(billPayments)
        .values({
          workingOrderId: party.tabId,
          submissionId: randomUUID(),
          fingerprint: "failed card",
          kind: "contribution",
          method: "card",
          applied: 500,
          state: "failed",
          failedAt: new Date().toISOString(),
          requestedBy: venue.operatorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning({ id: billPayments.id }),
    );
    const received = await payInCash(party.tabId, "10.00");

    const answer = await split(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((await paymentRows(venue, party.tabId)).map((row) => [row.id, row.state])).toEqual([
      [failed!.id, "failed"],
    ]);
    expect(
      (await paymentRows(venue, answer.json.billId as string)).map((row) => [row.id, row.state]),
    ).toEqual([[received, "received"]]);
  });

  it("a pending card still refuses", async () => {
    const party = await printed("Red wine bottle");
    await payInCash(party.tabId, "10.00");
    await inTx(venue, (tx) => seedPendingCardPayment(tx, party.tabId));

    await refused(party.tabId, "order.payment_in_flight");
  });

  it("a card charged but not yet recorded refuses", async () => {
    const party = await printed("Red wine bottle");
    await payInCash(party.tabId, "10.00");
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        workingOrderId: brandWorkingOrderId(party.tabId),
        provider: "fake",
        paymentRef: `captured-${randomUUID()}`,
        amount: centsToDecimal(2000),
        settledAt: new Date(),
      }),
    );

    await refused(party.tabId, "order.payment_in_flight");
  });

  it("refuses money still moving before dishes printed with Print anyway", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const ticket = await fixture.printBill(venue, party, party.tabId, true);
    expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
    await inTx(venue, (tx) => seedPendingCardPayment(tx, party.tabId));

    await refused(party.tabId, "order.payment_in_flight");
  });

  it("a pending refund refuses", async () => {
    const party = await printed("Red wine bottle");
    const paymentId = await payInCash(party.tabId, "10.00");
    await inTx(venue, (tx) =>
      tx.insert(refunds).values({
        billPaymentId: paymentId,
        ...billRefundFields(tx, venue.cfg.nodeId, paymentId),
        submissionId: randomUUID(),
        fingerprint: "pending refund",
        appliedAmount: 1000,
        reason: "error",
        authorizedBy: venue.adminId,
        requestedBy: venue.adminId,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        state: "pending",
      }),
    );

    await refused(party.tabId, "bill.refund_in_progress");
  });

  it("a received items payment refuses", async () => {
    const party = await printed("Red wine bottle", "Tarta");
    const items = await pay(party.tabId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      tendered: "18.00",
      applied: "18.00",
    });
    expect(items.status, JSON.stringify(items.json)).toBe(200);

    await refused(party.tabId, "bill.payments_received");
  });
});

/** The provider row of a card bill payment: its bill and the sale it is linked to. */
async function providerRowOf(billPaymentId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: payments.id, workingOrderId: payments.workingOrderId, saleId: payments.saleId })
      .from(payments)
      .where(eq(payments.billPaymentId, billPaymentId)),
  );
  return row!;
}

async function payByCard(billId: string, amount: string, keyed?: string): Promise<string> {
  const paid = await pay(billId, {
    kind: "contribution",
    amount,
    method: "card",
    applied: amount,
    ...(keyed === undefined ? { entry: "reader" } : { entry: "manual", externalRef: keyed }),
  });
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  return (paid.json.payment as { id: string }).id;
}

/** Splits the printed bill, answering the reopened bill's id. */
async function splitOk(billId: string): Promise<string> {
  const answer = await split(billId);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return answer.json.billId as string;
}

describe("Reopen to split carries a card's provider row", () => {
  it("a card paid before printing is linked to the new ticket", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await fixture.serve(venue, party, party.tabId)).status).toBe(200);
    const card = await payByCard(party.tabId, "10.00");
    const ticket = await fixture.printBill(venue, party, party.tabId);
    expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
    const original = await invoiceOf(party.tabId);
    expect(await providerRowOf(card)).toMatchObject({ saleId: original.id });

    const newBill = await splitOk(party.tabId);
    const rest = await cashPayment(venue, venue.cookie, newBill, "20.00");

    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(await statusOf(venue, newBill)).toBe("settled");
    expect(await providerRowOf(card)).toMatchObject({
      workingOrderId: newBill,
      saleId: (await invoiceOf(newBill)).id,
    });
  });

  it("a card paid after printing is not a stray to the reconcile sweep", async () => {
    const party = await printed("Red wine bottle");
    const card = await payByCard(party.tabId, "10.00");

    const newBill = await splitOk(party.tabId);

    const row = await providerRowOf(card);
    const listed = await inTx(venue, (tx) =>
      listReconcilable(tx, "fake", {
        from: new Date(Date.now() - 3_600_000),
        to: new Date(Date.now() + 3_600_000),
      }),
    );
    expect(listed.filter((entry) => entry.paymentId === row.id)).toEqual([
      expect.objectContaining({
        workingOrderId: newBill,
        workingOrderStatus: "open",
        saleId: null,
      }),
    ]);
  });

  it("a hand-keyed card's operation number prints on the new ticket", async () => {
    const party = await printed("Red wine bottle");
    await payByCard(party.tabId, "10.00", "OP-4B");

    const newBill = await splitOk(party.tabId);
    expect((await cashPayment(venue, venue.cookie, newBill, "20.00")).status).toBe(200);

    const ticket = await invoiceOf(newBill);
    const tender = await inTx(venue, (tx) => readTenderBlock(tx, brandSaleId(ticket.id), newBill));
    expect(tender).toMatchObject({ method: "card", charged: "10.00", reference: "OP-4B" });
  });

  it("a carried payment is refunded on the new bill", async () => {
    const party = await printed("Red wine bottle");
    const card = await payByCard(party.tabId, "10.00");
    const newBill = await splitOk(party.tabId);

    const refunded = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${newBill}/payments/${card}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "El cliente pagó de más",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );

    expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    expect(refunded.json).toMatchObject({ refund: { state: "completed", appliedAmount: "5.00" } });
    expect((await balanceOf(newBill)).json).toMatchObject({
      status: "open",
      received: "5.00",
      outstanding: "25.00",
    });
  });
});
