import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { findPaymentByRef } from "./store.js";
import { SimulatorPaymentProvider } from "./simulator.js";
import { billPaymentOfRow, freshNif, seedBillPayment, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // Child before parent: a `payment_refunds` row points at its payment.
  await suite.db.execute(sql`delete from payment_refunds`);
  await suite.db.execute(sql`delete from payments`);
});

async function setup() {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  const provider = new SimulatorPaymentProvider(suite.db);
  const params = {
    origin: deviceOrigin(seeded.deviceId),
    workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
    amount: decimal("10.00"),
  };
  return { seeded, provider, params };
}

/** The stored source and device of the payment with this reference. */
async function storedOrigin(paymentRef: string) {
  const rows = await suite.db.execute<{ source: string | null; device_id: string | null }>(
    sql`select source, device_id from payments where payment_ref = ${paymentRef}`,
  );
  return rows.rows[0];
}

describe("SimulatorPaymentProvider", () => {
  afterEach(() => vi.useRealTimers());
  it("stores the device a captured payment was started on", async () => {
    const { seeded, provider, params } = await setup();
    const result = await provider.collect({ ...params, simulationOutcome: "captured" });
    expect(await storedOrigin(result.paymentRef)).toEqual({
      source: "device",
      device_id: seeded.deviceId,
    });
  });

  it("stores the device a declined payment was started on", async () => {
    const { seeded, provider, params } = await setup();
    const result = await provider.collect({ ...params, simulationOutcome: "declined" });
    expect(await storedOrigin(result.paymentRef)).toEqual({
      source: "device",
      device_id: seeded.deviceId,
    });
  });

  it("captures the success scenario and persists the simulated payment", async () => {
    const { provider, params } = await setup();
    const result = await provider.collect({ ...params, simulationOutcome: "captured" });

    expect(result).toMatchObject({ provider: "simulator", state: "captured", amount: "10.00" });
    expect(result.settledAt).not.toBeNull();
    const row = await suite.db.transaction((tx) =>
      findPaymentByRef(tx, "simulator", result.paymentRef),
    );
    expect(row).toMatchObject({ state: "captured", amount: "10.00" });
  });

  it("returns and persists a failed payment for the decline scenario", async () => {
    const { provider, params } = await setup();
    const result = await provider.collect({ ...params, simulationOutcome: "declined" });

    expect(result).toMatchObject({ provider: "simulator", state: "failed", amount: "10.00" });
    expect(result.settledAt).toBeNull();
    const row = await suite.db.transaction((tx) =>
      findPaymentByRef(tx, "simulator", result.paymentRef),
    );
    expect(row?.state).toBe("failed");
  });

  it("captures by default and has no asynchronous work to forward", async () => {
    const { provider, params } = await setup();

    await expect(provider.collect(params)).resolves.toMatchObject({ state: "captured" });
    await expect(provider.forward(new Date())).resolves.toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });

  it("waits for the pretend reader's approval before recording a capture", async () => {
    const { provider, params } = await setup();
    const collecting = provider.collect({ ...params, readerRef: "waitron-demo-reader" });
    const pending = provider.pendingDemoReaderPayments();

    expect(pending).toMatchObject([{ amount: "10.00" }]);
    expect((await suite.db.execute(sql`select count(*) as n from payments`)).rows[0]).toEqual({
      n: 0,
    });

    provider.decideDemoReaderPayment(pending[0]!.id, "captured");
    await expect(collecting).resolves.toMatchObject({ state: "captured", amount: "10.00" });
    expect(provider.pendingDemoReaderPayments()).toEqual([]);
  });

  it("reports a pretend reader decline through the normal failed payment result", async () => {
    const { provider, params } = await setup();
    const collecting = provider.collect({ ...params, readerRef: "waitron-demo-reader" });
    const [pending] = provider.pendingDemoReaderPayments();

    provider.decideDemoReaderPayment(pending!.id, "declined");

    await expect(collecting).resolves.toMatchObject({ state: "failed", settledAt: null });
    expect(provider.pendingDemoReaderPayments()).toEqual([]);
  });

  it("clears a pretend reader when its paying device cancels", async () => {
    const { provider, params } = await setup();
    const collecting = provider.collect({ ...params, readerRef: "waitron-demo-reader" });
    const [pending] = provider.pendingDemoReaderPayments();

    expect(provider.cancelDemoReaderPayment(params.workingOrderId, params.origin.deviceId)).toBe(
      true,
    );
    expect(provider.pendingDemoReaderPayments()).toEqual([]);
    expect(provider.decideDemoReaderPayment(pending!.id, "captured")).toBe(false);
    await expect(collecting).resolves.toMatchObject({ state: "failed" });
  });

  it("honours cancellation received before the pretend collect reaches the provider", async () => {
    const { provider, params } = await setup();
    const attemptId = "00000000-0000-4000-8000-000000000248";

    expect(
      provider.cancelDemoReaderPayment(params.workingOrderId, params.origin.deviceId, attemptId),
    ).toBe(true);
    await expect(
      provider.collect({ ...params, readerRef: "waitron-demo-reader", demoAttemptId: attemptId }),
    ).resolves.toMatchObject({ state: "failed" });
    expect(provider.pendingDemoReaderPayments()).toEqual([]);
    const next = provider.collect({
      ...params,
      readerRef: "waitron-demo-reader",
      demoAttemptId: "next",
    });
    expect(provider.pendingDemoReaderPayments()).toHaveLength(1);
    provider.decideDemoReaderPayment(provider.pendingDemoReaderPayments()[0]!.id, "captured");
    await expect(next).resolves.toMatchObject({ state: "captured" });
  });

  it("does not cancel a later pretend reader attempt with an earlier attempt's token", async () => {
    const { provider, params } = await setup();
    const collecting = provider.collect({
      ...params,
      readerRef: "waitron-demo-reader",
      demoAttemptId: "00000000-0000-4000-8000-000000000249",
    });

    expect(
      provider.cancelDemoReaderPayment(
        params.workingOrderId,
        params.origin.deviceId,
        "00000000-0000-4000-8000-000000000248",
      ),
    ).toBe(false);
    expect(provider.pendingDemoReaderPayments()).toHaveLength(1);
    provider.decideDemoReaderPayment(provider.pendingDemoReaderPayments()[0]!.id, "captured");
    await expect(collecting).resolves.toMatchObject({ state: "captured" });
  });

  it("cancels the matching newer attempt even while an older attempt remains pending", async () => {
    const { provider, params } = await setup();
    const first = provider.collect({
      ...params,
      readerRef: "waitron-demo-reader",
      demoAttemptId: "first",
    });
    const second = provider.collect({
      ...params,
      readerRef: "waitron-demo-reader",
      demoAttemptId: "second",
    });
    const [older, newer] = provider.pendingDemoReaderPayments();

    expect(
      provider.cancelDemoReaderPayment(params.workingOrderId, params.origin.deviceId, "second"),
    ).toBe(true);
    expect(provider.pendingDemoReaderPayments()).toEqual([older]);
    await expect(second).resolves.toMatchObject({ state: "failed" });
    provider.decideDemoReaderPayment(older!.id, "captured");
    await expect(first).resolves.toMatchObject({ state: "captured" });
    expect(provider.decideDemoReaderPayment(newer!.id, "captured")).toBe(false);
  });

  it("expires an abandoned pretend reader request and records a failed result", async () => {
    vi.useFakeTimers();
    const { provider, params } = await setup();
    const collecting = provider.collect({ ...params, readerRef: "waitron-demo-reader" });
    const [pending] = provider.pendingDemoReaderPayments();

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(provider.pendingDemoReaderPayments()).toEqual([]);
    expect(provider.decideDemoReaderPayment(pending!.id, "captured")).toBe(false);
    await expect(collecting).resolves.toMatchObject({ state: "failed" });
  });

  it("has no provider-side payment attempt for resolvePending to forward", async () => {
    const { provider } = await setup();
    await expect(provider.resolvePending(new Date())).resolves.toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });

  it("voids a captured simulation", async () => {
    const { provider, params } = await setup();
    const captured = await provider.collect(params);

    await expect(provider.void(captured.paymentRef)).resolves.toMatchObject({
      state: "voided",
      amount: "10.00",
    });
  });

  it("fully refunds a captured simulation", async () => {
    const { provider, params } = await setup();
    const captured = await provider.collect(params);

    await expect(provider.refund(captured.paymentRef)).resolves.toMatchObject({
      state: "refunded",
      amount: "10.00",
    });
  });

  it("partially refunds a captured simulation", async () => {
    const { provider, params } = await setup();
    const captured = await provider.collect(params);

    await expect(provider.partialRefund(captured.paymentRef, decimal("4.00"))).resolves.toEqual({
      provider: "simulator",
      paymentRef: captured.paymentRef,
      state: "partially_refunded",
      amount: "4.00",
      settledAt: null,
    });
  });

  it("reports an unknown simulated payment reference", async () => {
    const { provider } = await setup();

    await expect(provider.void("sim-missing")).rejects.toMatchObject({
      code: "payment.not_found",
    });
  });

  it.each(["captured", "declined"] as const)(
    "names the bill payment it charges for on its %s row",
    async (simulationOutcome) => {
      const { seeded, provider, params } = await setup();
      const billPaymentId = await seedBillPayment(suite.db, seeded);

      const result = await provider.collect({ ...params, simulationOutcome, billPaymentId });

      expect(await billPaymentOfRow(suite.db, result.paymentRef)).toBe(billPaymentId);
    },
  );

  it("names no bill payment for a payment of the whole order", async () => {
    const { provider, params } = await setup();

    const result = await provider.collect(params);

    expect(await billPaymentOfRow(suite.db, result.paymentRef)).toBeNull();
  });
});

describe("SimulatorPaymentProvider refunds", () => {
  const send = (refundId: string) => ({
    processorRef: "sim-ext",
    amount: decimal("4.00"),
    idempotencyKey: `bpr_${refundId}`,
    refundId,
  });

  it("refunds at once, writing nothing, and finds the refund again by the caller's id", async () => {
    const { provider } = await setup();

    const answer = await provider.sendRefund(send("r-1"));
    const again = await provider.sendRefund(send("r-1"));
    const refunds = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from payment_refunds`,
    );

    expect(answer).toEqual({
      kind: "outcome",
      outcome: "completed",
      providerRefundRef: expect.stringMatching(/^sim-re-/) as unknown as string,
      providerStatus: "succeeded",
    });
    expect(again).toEqual(answer);
    expect(refunds.rows[0]!.n).toBe(0);
    expect(
      await provider.lookupRefund({
        processorRef: "sim-ext",
        refundId: "r-1",
        amount: decimal("4.00"),
        sentAt: new Date(),
        excludeRefs: [],
      }),
    ).toEqual({
      kind: "match",
      providerRefundRef: (answer as { providerRefundRef: string }).providerRefundRef,
      outcome: "completed",
      providerStatus: "succeeded",
    });
  });

  it("finds nothing for a refund it never made, and never resends", async () => {
    const { provider } = await setup();
    expect(
      await provider.lookupRefund({
        processorRef: "sim-ext",
        refundId: "r-unknown",
        amount: decimal("4.00"),
        sentAt: new Date(),
        excludeRefs: [],
      }),
    ).toEqual({ kind: "none" });
    expect(provider.refundResendWindowMs).toBeNull();
  });
});
