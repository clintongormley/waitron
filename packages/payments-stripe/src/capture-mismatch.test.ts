import { sql } from "drizzle-orm";
import { fullDiskOnCaptureAlert } from "@waitron/payments/test/capture-alert-disk.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, incidents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { diskFullIn, decimal, deviceOrigin, workingOrderId } from "@waitron/shared";
import {
  ChargeNotSavedError,
  PAYMENTS_MIGRATIONS,
  getPaymentByRef,
  insertAttempting,
  recordCaptureMismatch,
} from "@waitron/payments";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { ownsEveryPayment, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const now = new Date("2026-11-07T03:00:00.000Z");
const audit = { personId: "22222222-2222-4222-8222-222222222222" };
async function setup() {
  const seeded = await seedWorkingOrder(suite.db);
  const client = new FakeStripe();
  const make = () =>
    new StripeTerminalProvider({
      db: suite.db,
      client,
      captureAlerts,
      poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
    });
  const params = {
    origin: deviceOrigin(seeded.deviceId),
    workingOrderId: workingOrderId(seeded.workingOrderId),
    nodeId: seeded.nodeId,
    amount: decimal("12.10"),
    readerRef: "reader_1",
  };
  const row = (paymentRef: string) =>
    withTransaction(suite.db, (tx) => getPaymentByRef(tx, { provider: "stripe", paymentRef }));
  const attempt = async (status: string, received: number) => {
    const paymentRef = randomUUID();
    const externalRef = `pi_${paymentRef}`;
    client.setIntent(externalRef, { status, amount: 1210, amountReceived: received });
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, { ...params, provider: "stripe", paymentRef, externalRef }),
    );
    return { paymentRef, externalRef };
  };
  return { client, make, params, row, attempt };
}

describe("Stripe capture amount evidence", () => {
  it.each([0, 1200, 1300])(
    "holds a sweep mismatch of %s cents and alerts both figures",
    async (received) => {
      const { make, attempt, row, params } = await setup();
      const key = await attempt("succeeded", received);
      expect(await make().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
        nextDueAt: null,
        forwarded: 0,
        declined: 0,
        incidentsRaised: 1,
      });
      expect(await row(key.paymentRef)).toMatchObject({
        state: "attempting",
        amount: "12.10",
        settledAt: null,
        externalRef: key.externalRef,
      });
      const alerts = await suite.db.select().from(incidents);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.params).toEqual({
        payments: [
          {
            ...key,
            provider: "stripe",
            workingOrderId: params.workingOrderId,
            requestedAmount: "12.10",
            reportedAmount: received === 0 ? "0.00" : received === 1200 ? "12.00" : "13.00",
          },
        ],
      });
    },
  );

  it.each(["succeeded", "canceled", "requires_payment_method", "processing", "missing"])(
    "never lets a later %s answer resolve or recheck an acknowledged mismatch",
    async (status) => {
      const { client, make, attempt, row } = await setup();
      const key = await attempt("succeeded", 1200);
      await make().resolvePending(now, await ownsEveryPayment(suite.db));
      const [alert] = await suite.db.select().from(incidents);
      if (alert !== undefined)
        await withTransaction(suite.db, (tx) =>
          captureAlerts.handle(tx, { id: alert.id, personId: null, handledAt: now }),
        );
      client.setIntent(key.externalRef, { status, amount: 1210, amountReceived: 1210 });
      const read = vi.spyOn(client, "retrievePaymentIntent");
      const cancelled = vi.spyOn(client, "cancelPaymentIntent");
      expect(await make().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
        nextDueAt: null,
        forwarded: 0,
        declined: 0,
        incidentsRaised: 0,
      });
      expect(await make().resolveAbandonedAttempt(key.paymentRef, now, audit)).toMatchObject({
        outcome: "unknown",
        reason: "ambiguous",
      });
      expect(read).not.toHaveBeenCalled();
      expect(cancelled).not.toHaveBeenCalled();
      expect(await row(key.paymentRef)).toMatchObject({
        state: "attempting",
        settledAt: null,
        saleId: null,
      });
      expect(await suite.db.select().from(incidents)).toHaveLength(1);
    },
  );

  it("rechecks evidence in the resolving transaction after an exact answer was already in flight", async () => {
    const { client, make, attempt, row } = await setup();
    const key = await attempt("succeeded", 1210);
    const read = client.retrievePaymentIntent.bind(client);
    vi.spyOn(client, "retrievePaymentIntent").mockImplementationOnce(async (id) => {
      const answer = await read(id);
      await withTransaction(suite.db, (tx) =>
        recordCaptureMismatch(
          tx,
          captureAlerts,
          {
            ...key,
            provider: "stripe",
            workingOrderId: "order",
            requestedAmount: "12.10",
            reportedAmount: "12.00",
          },
          now,
        ),
      );
      return answer;
    });
    expect(await make().resolveAbandonedAttempt(key.paymentRef, now, audit)).toMatchObject({
      outcome: "unknown",
    });
    expect(await row(key.paymentRef)).toMatchObject({ state: "attempting", settledAt: null });
  });

  it("keeps ordinary uncertain rows due while skipping a held mismatch", async () => {
    const { make, attempt } = await setup();
    await attempt("succeeded", 1200);
    await attempt("future_status", 0);
    expect(await make().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
      nextDueAt: new Date(now.getTime() + 60000),
      forwarded: 0,
      declined: 0,
      incidentsRaised: 1,
    });
  });

  it.each(["processing", "unreachable"])(
    "leaves collect uncertain without recording a mismatch for %s",
    async (status) => {
      const { client, make, params } = await setup();
      if (status === "unreachable")
        vi.spyOn(client, "retrievePaymentIntent").mockRejectedValue(new Error("offline"));
      else
        vi.spyOn(client, "retrievePaymentIntent").mockResolvedValue({
          id: "pi_processing",
          status,
          amount: 1210,
          amountReceived: 0,
        });
      expect(await make().collect(params)).toMatchObject({ state: "attempting", settledAt: null });
      expect(await suite.db.select().from(incidents)).toEqual([]);
    },
  );
});

it("reports a known charge when the full disk prevents saving its mismatch alert", async () => {
  const { client, make, params, row } = await setup();
  vi.spyOn(client, "retrievePaymentIntent").mockResolvedValue({
    id: "pi_mismatch",
    status: "succeeded",
    amount: 1210,
    amountReceived: 1200,
  });
  const disk = fullDiskOnCaptureAlert(suite.db);
  let error: unknown;
  try {
    error = await make()
      .collect(params)
      .catch((e: unknown) => e);
  } finally {
    disk.lift();
  }
  expect(error).toBeInstanceOf(ChargeNotSavedError);
  expect(diskFullIn(error)).toBe(true);
  const { rows } = await suite.db.execute<{ payment_ref: string }>(
    sql`select payment_ref from payments`,
  );
  expect(await row(rows[0]!.payment_ref)).toMatchObject({ state: "attempting", settledAt: null });
  expect(await suite.db.select().from(incidents)).toEqual([]);
});
