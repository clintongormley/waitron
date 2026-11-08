import { sql } from "drizzle-orm";
import { fullDiskOnCaptureAlert } from "@waitron/payments/test/capture-alert-disk.js";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, incidents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { diskFullIn, decimal, deviceOrigin, workingOrderId } from "@waitron/shared";
import {
  ChargeNotSavedError,
  PAYMENTS_MIGRATIONS,
  payments,
  getPaymentByRef,
  captureAttempting,
  failAttempting,
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

it.each(["collect", "sweep"])("records actual Stripe amounts through %s", async (path) => {
  for (const [received, tipAmount, state, amount, alertCount] of [
    [1210, undefined, "captured", "12.10", 0],
    [1200, undefined, "captured", "12.00", 1],
    [1300, undefined, "captured", "13.00", 1],
    [1300, 90, "captured", "13.00", 0],
    [1300, 89, "captured", "13.00", 1],
    [0, undefined, "failed", "12.10", 1],
  ] as const) {
    const { client, make, params, row, attempt } = await setup();
    vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (id) => ({
      id,
      status: "succeeded",
      amount: 1210,
      amountReceived: received,
      tipAmount,
    }));
    let paymentRef: string;
    if (path === "collect") {
      const result = await make().collect(params);
      expect(result).toMatchObject({ state, amount });
      paymentRef = result.paymentRef;
    } else {
      paymentRef = (await attempt("succeeded", received)).paymentRef;
      expect(await make().resolvePending(now, await ownsEveryPayment(suite.db))).toMatchObject({
        forwarded: state === "captured" ? 1 : 0,
        declined: state === "failed" ? 1 : 0,
        incidentsRaised: alertCount,
      });
    }
    expect(await row(paymentRef)).toMatchObject({ state, amount });
    const stored = await suite.db.select().from(payments);
    expect(stored.find((p) => p.paymentRef === paymentRef)?.requestedAmount).toBe(1210);
    const alerts = await suite.db.select().from(incidents);
    const evidence = alerts
      .flatMap((a) => (a.params.payments ?? []) as { paymentRef: string }[])
      .filter((p) => p.paymentRef === paymentRef);
    expect(evidence).toHaveLength(alertCount);
  }
});

it("continues processor reads even when an old alert exists", async () => {
  const { make, attempt, row, params } = await setup();
  const key = await attempt("succeeded", 1200);
  await withTransaction(suite.db, (tx) =>
    recordCaptureMismatch(
      tx,
      captureAlerts,
      {
        ...key,
        provider: "stripe",
        workingOrderId: params.workingOrderId,
        requestedAmount: "12.10",
        reportedAmount: "12.00",
      },
      now,
    ),
  );
  expect(await make().resolveAbandonedAttempt(key.paymentRef, now, audit)).toMatchObject({
    outcome: "captured",
  });
  expect(await row(key.paymentRef)).toMatchObject({ state: "captured", amount: "12.00" });
  expect(await suite.db.select().from(incidents)).toHaveLength(1);
});

it.each(["processing", "unreachable"])("leaves collect uncertain for %s", async (status) => {
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

it.each(["captured", "failed"])(
  "keeps the first %s outcome when a Stripe sweep answers late",
  async (state) => {
    const { client, make, attempt, row } = await setup();
    const key = await attempt("succeeded", 1200);
    const read = client.retrievePaymentIntent.bind(client);
    vi.spyOn(client, "retrievePaymentIntent").mockImplementationOnce(async (id) => {
      await withTransaction(suite.db, (tx) =>
        state === "captured"
          ? captureAttempting(tx, {
              provider: "stripe",
              paymentRef: key.paymentRef,
              settledAt: now,
              externalRef: key.externalRef,
              amount: decimal("11.00"),
            })
          : failAttempting(tx, { provider: "stripe", paymentRef: key.paymentRef }),
      );
      return read(id);
    });
    expect(await make().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
    expect(await row(key.paymentRef)).toMatchObject({
      state,
      amount: state === "captured" ? "11.00" : "12.10",
    });
    expect(await suite.db.select().from(incidents)).toEqual([]);
  },
);

it("returns an already committed capture when the live Stripe answer remains uncertain", async () => {
  const { client, make, params } = await setup();
  vi.spyOn(client, "retrievePaymentIntent").mockImplementationOnce(async (id) => {
    const [payment] = await suite.db.select().from(payments);
    await withTransaction(suite.db, (tx) =>
      captureAttempting(tx, {
        provider: "stripe",
        paymentRef: payment!.paymentRef,
        externalRef: id,
        settledAt: now,
        amount: decimal("12.00"),
      }),
    );
    return { id, status: "processing", amount: 1210, amountReceived: 0 };
  });
  expect(await make().collect(params)).toMatchObject({
    state: "captured",
    amount: "12.00",
    settledAt: now,
  });
});
