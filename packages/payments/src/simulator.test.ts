import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { findPaymentByRef } from "./store.js";
import { SimulatorPaymentProvider } from "./simulator.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  await pg.db.execute(sql`truncate payment_refunds, payments cascade`);
});

async function setup() {
  const seeded = await seedWorkingOrder(pg.db, freshNif());
  const provider = new SimulatorPaymentProvider(pg.db, seeded.tenantId);
  const params = {
    tenantId: brandTenantId(seeded.tenantId),
    tillId: brandTillId(seeded.tillId),
    workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
    amount: decimal("10.00"),
  };
  return { seeded, provider, params };
}

describe("SimulatorPaymentProvider", () => {
  it("captures the success scenario and persists the simulated payment", async () => {
    const { seeded, provider, params } = await setup();
    const result = await provider.collect({ ...params, simulationOutcome: "captured" });

    expect(result).toMatchObject({ provider: "simulator", state: "captured", amount: "10.00" });
    expect(result.settledAt).not.toBeNull();
    const row = await pg.db.transaction((tx) =>
      findPaymentByRef(tx, "simulator", result.paymentRef),
    );
    expect(row).toMatchObject({ tenantId: seeded.tenantId, state: "captured", amount: "10.00" });
  });

  it("returns and persists a failed payment for the decline scenario", async () => {
    const { provider, params } = await setup();
    const result = await provider.collect({ ...params, simulationOutcome: "declined" });

    expect(result).toMatchObject({ provider: "simulator", state: "failed", amount: "10.00" });
    expect(result.settledAt).toBeNull();
    const row = await pg.db.transaction((tx) =>
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

  it("refuses a collect for another tenant", async () => {
    const { provider, params } = await setup();

    await expect(
      provider.collect({ ...params, tenantId: brandTenantId(crypto.randomUUID()) }),
    ).rejects.toMatchObject({ code: "payment.not_found" });
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
});
