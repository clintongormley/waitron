import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { billPayments, taxpayer, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { issueHeldBill } from "./bill-payment-settlement.js";
import { REASONS, type AdjustmentVenue } from "./testing/adjustment-venue.js";
import { cutDownOn, discountsHeldOn, salesOf, writtenAsItStood } from "./testing/bill-discounts.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

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

describe("paths nobody is asked on write a discount that no longer holds as it stood", () => {
  it("a bill whose invoice was held back once its money moved", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    const discountId = await cutDownOn(venue, giver, billId);
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
    expect(await salesOf(venue, billId)).toEqual([{ total: 2500 }]);
    expect(discountsHeldOn(venue, billId)).toEqual([]);
    expect(await writtenAsItStood(venue, billId)).toMatchObject([
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
    const discountId = await cutDownOn(venue, giver, billId);

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
    await vi.waitFor(async () => expect(await salesOf(venue, billId)).toEqual([{ total: 2500 }]));
    expect(discountsHeldOn(venue, billId)).toEqual([]);
    expect(await writtenAsItStood(venue, billId)).toMatchObject([
      { data: { discountId, why: "cut_down", takes: "18.00" } },
    ]);
  });

  it.each([
    {
      way: "cash",
      payment: { method: "cash", tendered: "30.00" },
      refund: {},
    },
    {
      way: "hand-keyed card",
      payment: { method: "card", entry: "manual", externalRef: "OP-1621" },
      refund: { manualConfirmed: true },
    },
  ])(
    "a $way refund of a bill payment that leaves the bill paid, completed in its own request",
    async ({ payment, refund }) => {
      const billId = await tabWith(venue, "Tarta", "Steak");
      const paid = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "30.00",
          applied: "30.00",
          tip: "0.00",
          ...payment,
        },
      );
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      const paymentId = (paid.json.payment as { id: string }).id;
      // The bill now owes 25.00 and holds 30.00.
      const discountId = await cutDownOn(venue, giver, billId);

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
          ...refund,
        },
      );

      expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
      expect(refunded.json).toMatchObject({ refund: { paymentId, state: "completed" } });
      expect(await salesOf(venue, billId)).toEqual([{ total: 2500 }]);
      expect(discountsHeldOn(venue, billId)).toEqual([]);
      expect(await writtenAsItStood(venue, billId)).toMatchObject([
        { data: { discountId, why: "cut_down", takes: "18.00" } },
      ]);
    },
  );
});
