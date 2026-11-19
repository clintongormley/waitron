import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction, workingOrders } from "@waitron/db";
import { insertAttempting, insertCapturedPayment, payments } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { ownsEveryPayment } from "@waitron/payments/test/seed.js";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { FakeSumUp } from "@waitron/payments-sumup/src/testing/fake-sumup.js";
import { decimal, deviceOrigin, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { provisionBillVenue, statusOf, tabWith, type BillVenue } from "./testing/bill-venue.js";
import {
  clockAtIso as clockAt,
  filedFor,
  managementPayments,
  retainedCapture,
} from "./testing/later-sale-date-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { payWorkingOrderIntegratedOrchestration as pay } from "./testing/whole-payment-fixture.js";
import { recoverAutomaticCardPayments } from "./pending-card-recovery.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// The owner's example, Europe/Madrid (UTC+1 in March): the card asked at 23:50 on 14 March, the
// box back and issuing at 09:10 on 15 March.
const ASKED = "2026-03-14T22:50:00.000Z";
const RECOVERED = "2026-03-15T08:10:00.000Z";

function askedAt(venue: BillVenue, paymentRef: string, createdAt: string) {
  return liftPaymentGuard(venue.db, () =>
    venue.db.update(payments).set({ createdAt }).where(eq(payments.paymentRef, paymentRef)),
  );
}

/** A tab of one plate of Croquettes paid by a card the reader captured, whose sale a restart left unfiled. */
async function retainedTab(venue: BillVenue, asked: string): Promise<string> {
  const id = await tabWith(venue, "Croquettes");
  await retainedCapture(venue, id, { amount: "10.00", asked, settled: RECOVERED });
  return id;
}

async function recover(venue: BillVenue, at: string) {
  return recoverAutomaticCardPayments({
    ...venue,
    clock: clockAt(at),
    admission: testTradingAdmission(),
  });
}

describe("a card recovered on a later day files the day it was asked", () => {
  it("files and prints 14 March for a card asked at 23:50 and recovered at 09:10 the next day", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await retainedTab(venue, ASKED);

    expect(await recover(venue, RECOVERED)).toEqual({ filed: 1, errors: [] });

    expect(await statusOf(venue, id)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, id);
    expect(supplyDay).toBe("2026-03-14");
    expect(ticket.invoiceType).toBe("F2");
    expect(ticket.saleDay).toBe("2026-03-14");
    expect(record).toEqual({ operationDate: "2026-03-14", issueDate: "2026-03-15" });
  });

  it("files no sale day when the card row is dated after the issue reading", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await retainedTab(venue, "2026-03-16T10:00:00.000Z");

    expect(await recover(venue, RECOVERED)).toEqual({ filed: 1, errors: [] });

    expect(await statusOf(venue, id)).toBe("settled");
    const { supplyDay, ticket, record } = await filedFor(venue, id);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-03-15" });
  });

  it("files 14 March when the manager resolves the stuck card the next morning", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Croquettes");
    const paymentRef = randomUUID();
    await withTransaction(venue.db, async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(venue.deviceId),
        workingOrderId: brandWorkingOrderId(id),
        nodeId: venue.cfg.nodeId,
        provider: venue.card.provider,
        paymentRef,
        amount: decimal("10.00"),
      });
      await tx
        .update(workingOrders)
        .set({ paymentAttemptAt: ASKED })
        .where(eq(workingOrders.id, id));
    });
    await askedAt(venue, paymentRef, ASKED);
    const post = await managementPayments(venue, RECOVERED);
    venue.card.scriptAbandonedAttempt({ outcome: "captured" });
    const [payment] = venue.db.all<{ id: string }>(
      sql`select id from payments where payment_ref = ${paymentRef}`,
    );

    const resolved = await post(`/management-api/payments/stuck/${payment!.id}/resolve`);

    expect(resolved.status).toBe(200);
    expect(resolved.json.outcome).toBe("filed");
    const { supplyDay, ticket, record } = await filedFor(venue, id);
    expect(supplyDay).toBe("2026-03-14");
    expect(ticket.saleDay).toBe("2026-03-14");
    expect(record.operationDate).toBe("2026-03-14");
  });

  it("keeps one date for a live card started at 23:58 and answered at 00:01", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Croquettes");
    const collect = venue.card.collect.bind(venue.card);
    vi.spyOn(venue.card, "collect").mockImplementation(async (params) => {
      const result = await collect(params);
      await askedAt(venue, result.paymentRef, "2026-03-14T22:58:00.000Z");
      return result;
    });

    const paid = await pay(
      {
        ...venue,
        provider: venue.card,
        clock: clockAt("2026-03-14T23:01:00.000Z"),
        admission: testTradingAdmission(),
      },
      venue.cfg,
      { id, lines: [] },
      venue.operatorId,
    );

    expect(paid.outcome).toBe("captured");
    const { supplyDay, ticket, record } = await filedFor(venue, id);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-03-15" });
  });

  // Europe/Madrid (UTC+2 from 29 March): the reader asked at 23:58 on 31 March, the card taken at
  // 00:01 on 1 April, and the box issuing at 09:00 on 1 April.
  const ASKED_31 = "2026-03-31T21:58:00.000Z";
  const TAKEN_1 = "2026-03-31T22:01:00.000Z";
  const MORNING_1 = "2026-04-01T07:00:00.000Z";

  function payAt(venue: BillVenue, id: string, at: string) {
    return pay(
      { ...venue, provider: venue.card, clock: clockAt(at), admission: testTradingAdmission() },
      venue.cfg,
      { id, lines: [] },
      venue.operatorId,
    );
  }

  it("files no sale day when a card answered live at 00:01 is filed at 09:00 after its filing failed", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Croquettes");
    const collect = venue.card.collect.bind(venue.card);
    vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
      const result = await collect(params);
      await liftPaymentGuard(venue.db, () =>
        venue.db
          .update(payments)
          .set({ createdAt: ASKED_31, settledAt: TAKEN_1 })
          .where(eq(payments.paymentRef, result.paymentRef)),
      );
      return result;
    });
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(new Error("filing failed"));

    await expect(payAt(venue, id, TAKEN_1)).rejects.toThrow("filing failed");
    expect(await statusOf(venue, id)).not.toBe("settled");
    const retried = await payAt(venue, id, MORNING_1);

    expect(retried.outcome).toBe("captured");
    const { supplyDay, ticket, record } = await filedFor(venue, id);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-04-01" });
  });

  // SumUp's own time is when the checkout began, a second after the box asked the reader, not the
  // tap (docs/research/2026-09-10-sumup-solo-experiments.md).
  const STARTED_31 = "2026-03-31T21:58:01.000Z";

  it.each([
    { started: STARTED_31, found: MORNING_1, issued: "2026-04-01" },
    {
      started: "2026-03-31T18:30:01.000Z",
      found: "2026-04-02T07:00:00.000Z",
      issued: "2026-04-02",
    },
  ])(
    "files 31 March for a SumUp card whose checkout began at $started and its check found at $found",
    async ({ started, found, issued }) => {
      const venue = await provisionBillVenue(suite.db);
      const id = await tabWith(venue, "Croquettes");
      const paymentRef = randomUUID();
      await withTransaction(venue.db, (tx) =>
        insertCapturedPayment(tx, {
          origin: venue.cfg.origin,
          nodeId: venue.cfg.nodeId,
          workingOrderId: brandWorkingOrderId(id),
          provider: venue.card.provider,
          paymentRef,
          amount: decimal("10.00"),
          externalRef: `found-${paymentRef}`,
          settledAt: new Date(found),
        }),
      );
      await liftPaymentGuard(venue.db, () =>
        venue.db
          .update(payments)
          .set({
            createdAt: new Date(Date.parse(started) - 1000).toISOString(),
            providerCheckoutStartedAt: started,
          })
          .where(eq(payments.paymentRef, paymentRef)),
      );

      expect((await payAt(venue, id, found)).outcome).toBe("captured");

      const { supplyDay, ticket, record } = await filedFor(venue, id);
      expect(supplyDay).toBe("2026-03-31");
      expect(ticket.saleDay).toBe("2026-03-31");
      expect(record).toEqual({ operationDate: "2026-03-31", issueDate: issued });
    },
  );

  it("files 31 March after SumUp's own check finds a card tapped at 00:01 and Pay is pressed at 09:00", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Croquettes");
    const client = new FakeSumUp();
    const sumup = new SumUpCloudProvider({
      captureAlerts,
      db: venue.db,
      client,
      incidents: () => Promise.resolve(true),
      poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const paymentRef = randomUUID();
    await withTransaction(venue.db, (tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(venue.deviceId),
        workingOrderId: brandWorkingOrderId(id),
        nodeId: venue.cfg.nodeId,
        provider: sumup.provider,
        paymentRef,
        amount: decimal("10.00"),
      }),
    );
    await askedAt(venue, paymentRef, ASKED_31);
    client.hold({
      foreignTransactionId: paymentRef,
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      timestamp: STARTED_31,
    });

    await sumup.resolvePending(new Date(MORNING_1), await ownsEveryPayment(venue.db));
    const [found] = await venue.db
      .select({
        startedAt: payments.providerCheckoutStartedAt,
        settledAt: payments.settledAt,
      })
      .from(payments)
      .where(eq(payments.paymentRef, paymentRef));
    expect(found).toEqual({ startedAt: STARTED_31, settledAt: MORNING_1 });

    const paid = await pay(
      { ...venue, provider: sumup, clock: clockAt(MORNING_1), admission: testTradingAdmission() },
      venue.cfg,
      { id, lines: [] },
      venue.operatorId,
    );

    expect(paid.outcome).toBe("captured");
    const { supplyDay, ticket, record } = await filedFor(venue, id);
    expect(supplyDay).toBe("2026-03-31");
    expect(ticket.saleDay).toBe("2026-03-31");
    expect(record).toEqual({ operationDate: "2026-03-31", issueDate: "2026-04-01" });
  });
});
