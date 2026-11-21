import { billRefundFields } from "./testing/bill-payment-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refunds, billPayments, withTransaction } from "@waitron/db";
import { payments, recordRefund } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { decimal } from "@waitron/shared";
import {
  provisionBillVenue,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import {
  capturedPending,
  clockAtIso as clockAt,
  filedFor,
  managementPayments,
} from "./testing/later-sale-date-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Europe/Madrid (UTC+1 in March): the card taken at 23:50 on 14 March, the bill completed at
// 09:10 on 15 March.
const ACCEPTED = "2026-03-14T22:50:00.000Z";
const COMPLETED = "2026-03-15T08:10:00.000Z";

function settleAt(venue: BillVenue, at: string) {
  return settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: clockAt(at),
    cfg: venue.cfg,
  });
}

/** The payments routes on `at`'s clock, with a manager signed in (PIN 1234). */
function management(venue: BillVenue, at: string) {
  return managementPayments(venue, at, { partialRefundRelease: true });
}

describe("a bill payment completed on a later day files the day it was accepted", () => {
  it("files and prints 14 March when the loop completes a card taken at 23:50 at 09:10 the next day", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    await capturedPending(venue, billId, 1000, { bill: ACCEPTED, card: ACCEPTED });

    expect(await settleAt(venue, COMPLETED)).toMatchObject({ received: 1 });

    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-14");
    expect(ticket.saleDay).toBe("2026-03-14");
    expect(record).toEqual({ operationDate: "2026-03-14", issueDate: "2026-03-15" });
  });

  it("takes the card row's 23:50 when the bill payment row was written at 09:10", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    const { billPaymentId } = await capturedPending(venue, billId, 1000, {
      bill: COMPLETED,
      card: ACCEPTED,
    });
    const post = await management(venue, COMPLETED);

    const attested = await post(`/management-api/payments/bill-payments/${billPaymentId}/attest`, {
      outcome: "received",
      note: "The provider's dashboard shows it charged",
      pin: "1234",
    });

    expect(attested.status).toBe(200);
    expect(attested.json.outcome).toBe("received");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-14");
    expect(ticket.saleDay).toBe("2026-03-14");
    expect(record.operationDate).toBe("2026-03-14");
  });

  it("files 14 March when the manager resolves the stuck bill payment the next morning", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    const { billPaymentId } = await capturedPending(venue, billId, 1000, {
      bill: ACCEPTED,
      card: ACCEPTED,
    });
    const post = await management(venue, COMPLETED);

    const resolved = await post(`/management-api/payments/bill-payments/${billPaymentId}/resolve`);

    expect(resolved.status).toBe(200);
    expect(resolved.json.outcome).toBe("received");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-14");
    expect(ticket.saleDay).toBe("2026-03-14");
    expect(record.operationDate).toBe("2026-03-14");
  });

  it.each([ACCEPTED, COMPLETED])("dates a retained card with bill row at %s", async (bill) => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    const { billPaymentId, paymentId } = await capturedPending(venue, billId, 1000, {
      bill,
      card: ACCEPTED,
    });
    await withTransaction(venue.db, async (tx) => {
      const [card] = await tx
        .update(payments)
        .set({ amount: 1100, externalRef: "partial-txn" })
        .where(eq(payments.billPaymentId, billPaymentId))
        .returning({ paymentRef: payments.paymentRef });
      await recordRefund(tx, {
        provider: venue.card.provider,
        paymentRef: card!.paymentRef,
        amount: decimal("1.00"),
        providerRefundRef: "first",
      });
    });
    Object.assign(venue.card, {
      lookupCompletedRefunds: async () => ({
        kind: "known" as const,
        processorRef: "partial-txn",
        captured: decimal("11.00"),
        refunds: [{ providerRefundRef: "first", amount: decimal("1.00") }],
      }),
    });
    const post = await management(venue, COMPLETED);

    const retained = await post(`/management-api/payments/partial-refunds/${paymentId}/retain`, {
      remaining: "10.00",
      applied: "10.00",
      tip: "0.00",
    });

    expect(retained.status).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-14");
    expect(ticket.saleDay).toBe("2026-03-14");
    expect(record.operationDate).toBe("2026-03-14");
  });

  it("keeps one date for a reader answering live at 00:01 a card asked at 23:58", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    const asked = "2026-03-14T22:58:00.000Z";
    const collect = venue.card.collect.bind(venue.card);
    // The bill payment row keeps the moment it was written (its trigger refuses a new
    // `created_at`), which is after this test's clock, so the card row alone carries 23:58.
    vi.spyOn(venue.card, "collect").mockImplementation(async (params) => {
      const result = await collect(params);
      await liftPaymentGuard(venue.db, () =>
        venue.db
          .update(payments)
          .set({ createdAt: asked })
          .where(eq(payments.paymentRef, result.paymentRef)),
      );
      return result;
    });

    const paid = await send(
      venue.appAt(clockAt("2026-03-14T23:01:00.000Z")),
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "card",
        entry: "reader",
        applied: "10.00",
        tip: "0.00",
      },
    );

    expect(paid.status).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-03-15" });
  });

  it("files no sale day when the latest payment was taken on the issue day", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes", "Croquettes");
    const evening = "2026-03-14T22:00:00.000Z";
    const morning = "2026-03-15T07:00:00.000Z";
    await capturedPending(venue, billId, 1000, { bill: evening, card: evening });
    await capturedPending(venue, billId, 1000, { bill: morning, card: morning });

    expect(await settleAt(venue, COMPLETED)).toMatchObject({ received: 2 });

    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-03-15" });
  });

  it("files 31 March for a card kept from then when cash taken on 1 April was given back in full", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    // Europe/Madrid (UTC+2 from 29 March): the card at 23:50 on 31 March, the last day of a quarter.
    const card = "2026-03-31T21:50:00.000Z";
    await capturedPending(venue, billId, 1000, { bill: card, card });
    await withTransaction(venue.db, async (tx) => {
      const [cash] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: "returned-cash",
          kind: "contribution",
          method: "cash",
          applied: 1000,
          tip: 0,
          tendered: 1000,
          state: "received",
          requestedBy: venue.operatorId,
          source: "device",
          deviceId: venue.deviceId,
          createdAt: "2026-04-01T07:00:00.000Z",
          receivedAt: "2026-04-01T07:00:00.000Z",
        })
        .returning({ id: billPayments.id });
      await tx.insert(refunds).values({
        billPaymentId: cash!.id,
        ...billRefundFields(tx, venue.cfg.nodeId, cash!.id),
        submissionId: randomUUID(),
        fingerprint: "cash-given-back",
        appliedAmount: 1000,
        tipAmount: 0,
        reason: "The card was charged",
        authorizedBy: venue.adminId,
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        state: "completed",
        createdAt: "2026-04-01T07:05:00.000Z",
        completedAt: "2026-04-01T07:05:00.000Z",
      });
    });

    expect(await settleAt(venue, "2026-04-01T08:10:00.000Z")).toMatchObject({ received: 1 });

    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-31");
    expect(ticket.saleDay).toBe("2026-03-31");
    expect(record).toEqual({ operationDate: "2026-03-31", issueDate: "2026-04-01" });
  });

  // Europe/Madrid (UTC+2 from 29 March): the reader asked at 23:58 on 31 March, the card taken at
  // 00:01 on 1 April, and the bill completed at 09:00 on 1 April.
  const ASKED_31 = "2026-03-31T21:58:00.000Z";
  const TAKEN_1 = "2026-03-31T22:01:00.000Z";
  const MORNING_1 = "2026-04-01T07:00:00.000Z";

  it("files no sale day when the loop completes a card answered live at 00:01, asked at 23:58", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    await capturedPending(venue, billId, 1000, {
      bill: ASKED_31,
      card: ASKED_31,
      settled: TAKEN_1,
    });

    expect(await settleAt(venue, MORNING_1)).toMatchObject({ received: 1 });

    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-04-01" });
  });

  it("files 31 March for a card Stripe's check found at 09:00, its row written at 23:58", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await tabWith(venue, "Croquettes");
    await capturedPending(venue, billId, 1000, {
      bill: ASKED_31,
      card: ASKED_31,
      settled: MORNING_1,
      resolved: true,
    });

    expect(await settleAt(venue, MORNING_1)).toMatchObject({ received: 1 });

    const { supplyDay, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-31");
    expect(record).toEqual({ operationDate: "2026-03-31", issueDate: "2026-04-01" });
  });

  // SumUp's own time is when the checkout began, a second after the box asked the reader, not the
  // tap (docs/research/2026-09-10-sumup-solo-experiments.md).
  it.each([
    { started: "2026-03-31T21:58:01.000Z", found: MORNING_1, issued: "2026-04-01" },
    {
      started: "2026-03-31T18:30:01.000Z",
      found: "2026-04-02T07:00:00.000Z",
      issued: "2026-04-02",
    },
  ])(
    "files 31 March for a SumUp card whose checkout began at $started and its check found at $found",
    async ({ started, found, issued }) => {
      const venue = await provisionBillVenue(suite.db);
      const billId = await tabWith(venue, "Croquettes");
      const asked = new Date(Date.parse(started) - 1000).toISOString();
      await capturedPending(venue, billId, 1000, {
        bill: asked,
        card: asked,
        settled: found,
        checkoutStartedAt: started,
      });

      expect(await settleAt(venue, found)).toMatchObject({ received: 1 });

      const { supplyDay, record } = await filedFor(venue, billId);
      expect(supplyDay).toBe("2026-03-31");
      expect(record).toEqual({ operationDate: "2026-03-31", issueDate: issued });
    },
  );
});
