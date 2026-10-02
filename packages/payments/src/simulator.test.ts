import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
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
    tillId: brandTillId(seeded.tillId),
    workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
    amount: decimal("10.00"),
  };
  return { seeded, provider, params };
}

describe("SimulatorPaymentProvider", () => {
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

  it("resolvePending is all-zeros (synchronous collect leaves nothing attempting)", async () => {
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
