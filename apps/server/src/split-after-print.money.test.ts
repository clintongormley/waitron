import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billAdvances,
  billPayments,
  refunds,
  sales,
  tenders,
  workingOrderLines,
} from "@waitron/db";
import { saleId as brandSaleId, thousandthsToDecimal } from "@waitron/shared";
import { invoiceRecords } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { readBillEditState } from "./bill-editing.js";
import { readReceiptPayments } from "./receipt-payments.js";
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

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function dishesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
}

async function serve(party: Party): Promise<void> {
  const dishes = (await dishesOf(party.tabId)).filter((line) => line.parentLineId === null);
  const served = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${party.partyId}/served`,
    {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(party.partyId),
      items: dishes.map((line) => ({
        lineId: line.id,
        quantity: thousandthsToDecimal(line.quantity),
      })),
    },
  );
  expect(served.status, JSON.stringify(served.json)).toBe(200);
}

async function print(party: Party): Promise<void> {
  const billId = party.tabId;
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, billId),
  );
  const printed = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${party.partyId}/end-meal`,
    {
      billId,
      expectedPartyRevision: revisionOf(party.partyId),
      expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
      submissionId: randomUUID(),
    },
  );
  expect(printed.status, JSON.stringify(printed.json)).toBe(200);
}

/** A party's dishes, served and printed. */
async function printed(...names: string[]): Promise<Party> {
  const party = await seatedWith(venue, ...names);
  await serve(party);
  await print(party);
  return party;
}

function split(billId: string): Promise<Answer> {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/split-after-print`,
    {},
  );
}

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

async function invoiceOf(billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!;
}

function creditsOf(saleId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.correctsSaleId, saleId)));
}

function balanceOf(billId: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

/** Everything a split would write: the corrective and its record, the copied bill and its dishes. */
function written() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from ${invoiceRecords}) as records,
      (select count(*) from working_orders) as bills,
      (select count(*) from working_order_lines) as lines,
      (select group_concat(id || ':' || working_order_id, ',') from bill_payments) as payments
  `)[0];
}

async function expectRefused(billId: string, code: string): Promise<void> {
  const before = written();
  const answered = await split(billId);
  expect({ status: answered.status, code: answered.json.code }).toEqual({ status: 409, code });
  expect(answered.json.params).toEqual({ workingOrderId: billId });
  expect(written()).toEqual(before);
  expect(await statusOf(venue, billId)).toBe("placed");
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
          .innerJoin(billPayments, eq(billPayments.id, tenders.billPaymentId))
          .where(eq(tenders.saleId, saleId))
          .orderBy(asc(billPayments.receivedAt), sql`${billPayments}.rowid`),
      );
    const taken = await tendersOf(ticket.id);
    expect(taken.map((row) => row.amount)).toEqual([1000, 2000]);
    expect(taken[0]!.billPaymentId).toBe(carried);
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

    await expectRefused(party.tabId, "order.payment_in_flight");
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

    await expectRefused(party.tabId, "bill.refund_in_progress");
  });

  it("an advance refuses", async () => {
    const party = await seatedWith(venue, "Red wine bottle", "Tarta");
    const advance = await pay(party.tabId, {
      kind: "contribution",
      amount: "30.00",
      tendered: "30.00",
      applied: "30.00",
      ownReceipt: true,
    });
    expect(advance.status, JSON.stringify(advance.json)).toBe(200);
    await serve(party);
    await print(party);
    const advances = () =>
      inTx(venue, (tx) =>
        tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, party.tabId)),
      );
    const before = await advances();
    expect(before).toHaveLength(1);

    await expectRefused(party.tabId, "bill.has_advance");

    expect(await advances()).toEqual(before);
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

    await expectRefused(party.tabId, "bill.payments_received");
  });

  it("a received card payment refuses until its provider row can move with it", async () => {
    const party = await printed("Red wine bottle");
    const keyed = await pay(party.tabId, {
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "manual",
      applied: "10.00",
    });
    expect(keyed.status, JSON.stringify(keyed.json)).toBe(200);

    await expectRefused(party.tabId, "bill.payments_received");
  });
});
