import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPayments, saleSettlements, sales } from "@waitron/db";
import { insertCapturedPayment } from "@waitron/payments";
import { centsToDecimal, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { printOrderForTest } from "./testing/issue-order.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  fiscalRecordCount,
  inTx,
  paymentRows,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// A bill whose ticket was issued before it was paid (printed, or left unpaid) takes part payments;
// the payment that completes it settles that same ticket with every payment as a tender.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

function print(billId: string): Promise<void> {
  return printOrderForTest(
    { db: venue.db, backend: venue.backend, clock: venue.clock, admission: testTradingAdmission() },
    venue.cfg,
    billId,
    venue.operatorId,
  );
}

function pay(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    method: "cash",
    tip: "0.00",
    ...body,
  });
}

function payInCash(billId: string, amount: string) {
  return pay(billId, { kind: "contribution", amount, tendered: amount, applied: amount });
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

async function printed(...names: string[]) {
  const party = await seatedWith(venue, ...names);
  await print(party.tabId);
  const [sale] = await salesOf(party.tabId);
  return { ...party, saleId: sale!.id };
}

describe("a printed bill", () => {
  it("a printed bill takes a cash contribution", async () => {
    const bill = await printed("Red wine bottle");

    const paid = await payInCash(bill.tabId, "5.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await paymentRows(venue, bill.tabId)).toEqual([
      expect.objectContaining({ applied: 500, state: "received" }),
    ]);
    expect(await salesOf(bill.tabId)).toEqual([{ id: bill.saleId, total: 3000, settledAt: null }]);
    expect(await statusOf(venue, bill.tabId)).toBe("placed");
    expect(fiscalRecordCount(venue, bill.tabId)).toBe(1);
  });

  it("the payment that completes a printed bill settles its ticket, with every payment as a tender", async () => {
    const bill = await printed("Red wine bottle");

    expect((await payInCash(bill.tabId, "5.00")).status).toBe(200);
    const last = await payInCash(bill.tabId, "25.00");

    expect(last.status, JSON.stringify(last.json)).toBe(200);
    expect(await salesOf(bill.tabId)).toEqual([
      { id: bill.saleId, total: 3000, settledAt: expect.any(String) },
    ]);
    expect(await statusOf(venue, bill.tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, bill.tabId)).toBe(1);
    const payments = await paymentRows(venue, bill.tabId);
    const tenders = await tendersOfBill(venue, bill.tabId);
    expect(tenders.map((row) => [row.billPaymentId, row.amount]).sort()).toEqual(
      payments.map((row) => [row.id, row.applied]).sort(),
    );
    expect(tenders.reduce((sum, row) => sum + row.amount, 0)).toBe(3000);
  });

  it("items and equal shares can be paid on a printed bill", async () => {
    const bill = await printed("Red wine bottle", "Steak");

    const items = await pay(bill.tabId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      tendered: "25.00",
      applied: "25.00",
    });
    expect(items.status, JSON.stringify(items.json)).toBe(200);
    const share = await pay(bill.tabId, {
      kind: "share",
      shareOf: 2,
      tendered: "50.00",
      applied: "15.00",
    });
    expect(share.status, JSON.stringify(share.json)).toBe(200);
    const rest = await payInCash(bill.tabId, "15.00");

    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(await salesOf(bill.tabId)).toEqual([
      { id: bill.saleId, total: 5500, settledAt: expect.any(String) },
    ]);
    expect((await tendersOfBill(venue, bill.tabId)).map((row) => row.amount).sort()).toEqual([
      1500, 1500, 2500,
    ]);
  });

  it("a card part payment completed later settles the printed ticket", async () => {
    const bill = await printed("Red wine bottle");
    expect((await payInCash(bill.tabId, "5.00")).status).toBe(200);
    const [pending] = await inTx(venue, (tx) =>
      tx
        .insert(billPayments)
        .values({
          workingOrderId: bill.tabId,
          submissionId: randomUUID(),
          fingerprint: "stranded",
          kind: "contribution",
          method: "card",
          applied: 2500,
          tip: 0,
          state: "pending",
          requestedBy: venue.operatorId,
          source: "device",
          deviceId: venue.device2Id,
        })
        .returning({ id: billPayments.id }),
    );
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        workingOrderId: brandWorkingOrderId(bill.tabId),
        provider: "fake",
        paymentRef: `captured-${randomUUID()}`,
        amount: centsToDecimal(2500),
        settledAt: new Date(),
        billPaymentId: pending!.id,
      }),
    );

    await settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
    });

    expect(await salesOf(bill.tabId)).toEqual([
      { id: bill.saleId, total: 3000, settledAt: expect.any(String) },
    ]);
    expect(await statusOf(venue, bill.tabId)).toBe("settled");
    expect((await tendersOfBill(venue, bill.tabId)).map((row) => row.amount).sort()).toEqual([
      2500, 500,
    ]);
  });

  it("a part payment taken before printing is kept and counted", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await payInCash(party.tabId, "5.00")).status).toBe(200);
    await print(party.tabId);
    const [sale] = await salesOf(party.tabId);

    const rest = await payInCash(party.tabId, "25.00");

    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(await salesOf(party.tabId)).toEqual([
      { id: sale!.id, total: 3000, settledAt: expect.any(String) },
    ]);
    expect((await tendersOfBill(venue, party.tabId)).map((row) => row.amount).sort()).toEqual([
      2500, 500,
    ]);
  });

  it("a whole collect of a printed bill holding a part payment is still refused", async () => {
    const bill = await printed("Red wine bottle");
    expect((await payInCash(bill.tabId, "5.00")).status).toBe(200);

    const collected = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${bill.tabId}/collect`,
      { tender: { method: "cash", amount: "25.00" } },
    );

    expect(collected).toMatchObject({ status: 409, json: { code: "bill.payments_received" } });
    expect(await salesOf(bill.tabId)).toEqual([{ id: bill.saleId, total: 3000, settledAt: null }]);
    expect(await paymentRows(venue, bill.tabId)).toHaveLength(1);
  });
});
