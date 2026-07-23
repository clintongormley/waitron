import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  AppError,
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { findPaymentByRef } from "../store.js";
import { FakePaymentProvider } from "./fake-provider.js";
import { freshNif, seedWorkingOrder } from "../../test/seed.js";
import type { Seeded } from "../../test/seed.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate payment_refunds, payments cascade`);
});

// beforeEach truncates payments/payment_refunds only — tenants (and the location/till/
// working_order chain under them) accumulate for the life of the suite. Each test needs its own
// NIF, or a later seedWorkingOrder's default "B00000000" collides on tenants_nif_key. `freshNif`
// is shared from ../../test/seed.js.

async function seedTenant(): Promise<Seeded> {
  return seedWorkingOrder(db, freshNif());
}

async function collect(provider: FakePaymentProvider, s: Seeded, amount = "10.00") {
  return provider.collect({
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal(amount),
  });
}

describe("FakePaymentProvider.collect", () => {
  it("returns a captured result with a settledAt and persists it", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db);
    const r = await collect(provider, s);
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    expect(r.provider).toBe("fake");
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row?.state).toBe("captured");
    expect(row?.tenantId).toBe(s.tenantId);
    expect(row?.amount).toBe("10.00");
  });

  it("returns a failed result with a null settledAt after failNextCollect, then recovers on the next call", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db);
    provider.failNextCollect();
    const failed = await collect(provider, s);
    expect(failed.state).toBe("failed");
    expect(failed.settledAt).toBeNull();
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", failed.paymentRef));
    expect(row?.state).toBe("failed");

    // The flag is one-shot: the very next collect succeeds again.
    const recovered = await collect(provider, s);
    expect(recovered.state).toBe("captured");
    expect(recovered.settledAt).not.toBeNull();
  });
});

describe("FakePaymentProvider.void", () => {
  it("reverses a captured payment to voided", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db);
    const paid = await collect(provider, s);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const provider = new FakePaymentProvider(db);
    const error = await provider.void("unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.refund", () => {
  it("refund of the full amount marks the payment refunded", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db);
    const paid = await collect(provider, s);
    const refunded = await provider.refund(paid.paymentRef);
    expect(refunded.state).toBe("refunded");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const provider = new FakePaymentProvider(db);
    const error = await provider.refund("unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.partialRefund", () => {
  it("refunding part of the captured amount marks the payment partially_refunded", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db);
    const paid = await collect(provider, s, "20.00");
    const partial = await provider.partialRefund(paid.paymentRef, decimal("12.00"));
    expect(partial.state).toBe("partially_refunded");
  });
});

describe("FakePaymentProvider.capabilities", () => {
  it("advertises partialRefund support", () => {
    expect(new FakePaymentProvider(db).capabilities.partialRefund).toBe(true);
  });
});
