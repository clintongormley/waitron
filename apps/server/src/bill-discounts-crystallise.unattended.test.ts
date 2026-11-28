import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { activityLog, billPayments, sales, taxpayer, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { issueHeldBill } from "./bill-payment-settlement.js";
import { REASONS, lineIdOf, type AdjustmentVenue } from "./testing/adjustment-venue.js";
import { holdDiscount } from "./testing/bill-discounts.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// The issuing paths no person waits on write a held discount that no longer holds as it stood,
// rather than refuse it (plan A1621 D6).
let venue: BillVenue;
let giver: Pick<AdjustmentVenue, "reasonId" | "staffId">;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    const complaint = await withTransaction(
      db,
      async (tx) => (await createAdjustmentReason(tx, REASONS.complaint)).id,
    );
    giver = {
      reasonId: { complaint } as AdjustmentVenue["reasonId"],
      staffId: venue.operatorId,
    };
  },
});

/** 50.00 off the bill's first line (Tarta, 18.00), more than it costs: it no longer holds as
 * given, and as it stands takes 18.00 off. */
async function cutDownOn(billId: string): Promise<string> {
  const lineId = await lineIdOf(venue, billId, 1);
  return inTx(venue, (tx) =>
    holdDiscount(tx, giver, {
      lineId,
      action: "discount_amount",
      percentBp: null,
      amount: 5000,
    }),
  );
}

async function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
}

function stillHeld(billId: string) {
  return venue.db.all(sql`
    select id from bill_discounts where working_order_id = ${billId}
      or line_id in (select id from working_order_lines where working_order_id = ${billId})`);
}

async function writtenAsItStood(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ data: activityLog.data })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.kind, "discount.written_as_it_stood"),
          eq(activityLog.subjectId, billId),
        ),
      ),
  );
}

describe("paths nobody is asked on write a discount that no longer holds as it stood", () => {
  it("a bill whose invoice was held back once its money moved", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    const discountId = await cutDownOn(billId);
    // Received without issuing, as a card captured while the invoice waited leaves it.
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: randomUUID(),
        kind: "contribution",
        method: "cash",
        applied: 2500,
        tendered: 2500,
        tip: 0,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
      }),
    );

    const issued = await inTx(venue, (tx) =>
      issueHeldBill(
        tx,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        venue.cfg,
        billId,
        venue.operatorId,
      ),
    );

    expect(issued).not.toBeNull();
    expect(await salesOf(billId)).toEqual([{ total: 2500 }]);
    expect(stillHeld(billId)).toEqual([]);
    expect(await writtenAsItStood(billId)).toMatchObject([
      { data: { discountId, why: "cut_down", takes: "18.00" } },
    ]);
  });

  it("a completed refund of a bill payment that leaves the bill paid", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    const card = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "30.00",
        method: "card",
        entry: "reader",
        applied: "30.00",
        tip: "0.00",
      },
    );
    expect(card.status, JSON.stringify(card.json)).toBe(200);
    const paymentId = (card.json.payment as { id: string }).id;
    // The bill now owes 25.00 and holds 30.00.
    const discountId = await cutDownOn(billId);

    const refunded = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Overpaid",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );

    expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    await vi.waitFor(async () => expect(await salesOf(billId)).toEqual([{ total: 2500 }]));
    expect(stillHeld(billId)).toEqual([]);
    expect(await writtenAsItStood(billId)).toMatchObject([
      { data: { discountId, why: "cut_down", takes: "18.00" } },
    ]);
  });
});
