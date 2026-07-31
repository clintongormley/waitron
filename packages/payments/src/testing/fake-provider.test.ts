import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { openIncidents } from "@waitron/core";
import {
  AppError,
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { associatePaymentWithSale, findPaymentByRef } from "../store.js";
import { FakePaymentProvider } from "./fake-provider.js";
import { freshNif, seedPaymentPolicy, seedSale, seedWorkingOrder } from "../../test/seed.js";
import type { Seeded } from "../../test/seed.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  if (db !== undefined) await db.close();
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

async function collect(
  provider: FakePaymentProvider,
  s: Seeded,
  amount = "10.00",
  allowOffline?: boolean,
) {
  return provider.collect({
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal(amount),
    ...(allowOffline === undefined ? {} : { allowOffline }),
  });
}

describe("FakePaymentProvider.collect", () => {
  it("returns a captured result with a settledAt and persists it", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db, s.tenantId);
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
    const provider = new FakePaymentProvider(db, s.tenantId);
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
    const provider = new FakePaymentProvider(db, s.tenantId);
    const paid = await collect(provider, s);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const provider = new FakePaymentProvider(db, randomUUID());
    const error = await provider.void("unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.refund", () => {
  it("refund of the full amount marks the payment refunded", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db, s.tenantId);
    const paid = await collect(provider, s);
    const refunded = await provider.refund(paid.paymentRef);
    expect(refunded.state).toBe("refunded");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const provider = new FakePaymentProvider(db, randomUUID());
    const error = await provider.refund("unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.partialRefund", () => {
  it("refunding part of the captured amount marks the payment partially_refunded", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db, s.tenantId);
    const paid = await collect(provider, s, "20.00");
    const partial = await provider.partialRefund(paid.paymentRef, decimal("12.00"));
    expect(partial.state).toBe("partially_refunded");
  });

  it("partialRefund reports the refunded amount, not the captured total", async () => {
    const seeded = await seedTenant();
    const provider = new FakePaymentProvider(db, seeded.tenantId);
    const paid = await provider.collect({
      tenantId: brandTenantId(seeded.tenantId),
      tillId: brandTillId(seeded.tillId),
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      amount: decimal("20.00"),
    });
    const refunded = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
    expect(refunded.amount).toBe(decimal("5.00"));
    expect(refunded.state).toBe("partially_refunded");
  });
});

describe("FakePaymentProvider.capabilities", () => {
  it("advertises partialRefund support", () => {
    expect(new FakePaymentProvider(db, randomUUID()).capabilities.partialRefund).toBe(true);
  });
});

describe("FakePaymentProvider.collect offline", () => {
  it("accepts offline when policy allows, staff opt in, and amount is within the cap", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", true);
    expect(r.state).toBe("accepted_offline");
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row?.state).toBe("accepted_offline");
    expect(row?.settledAt).not.toBeNull();
  });

  it("returns network_unavailable and writes nothing when staff did not opt in", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", false);
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row).toBeUndefined();
  });

  it("returns network_unavailable when there is no policy row (fail-safe)", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db, s.tenantId);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", true);
    expect(r.state).toBe("network_unavailable");
  });

  it("returns network_unavailable over the cap", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "50.01", true);
    expect(r.state).toBe("network_unavailable");
  });

  it("offlineNextCollect is one-shot — the next collect is a normal online capture", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    provider.offlineNextCollect();
    await collect(provider, s, "10.00", true);
    const online = await collect(provider, s, "10.00", true);
    expect(online.state).toBe("captured");
  });
});

// helper: offline-accept a payment for `s`, then associate it to a fresh sale, returning the ref.
async function acceptOfflineAndAssociate(
  provider: FakePaymentProvider,
  s: Seeded,
  amount = "10.00",
): Promise<string> {
  provider.offlineNextCollect();
  const r = await collect(provider, s, amount, true);
  const saleId = await seedSale(db, s);
  await db.transaction((tx) =>
    associatePaymentWithSale(tx, {
      tenantId: s.tenantId,
      provider: "fake",
      paymentRef: r.paymentRef,
      saleId,
    }),
  );
  return r.paymentRef;
}

describe("FakePaymentProvider.forward", () => {
  it("settles an accepted_offline payment the network clears", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    const ref = await acceptOfflineAndAssociate(provider, s);
    const result = await provider.forward(new Date());
    expect(result).toMatchObject({
      forwarded: 1,
      declined: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    });
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", ref));
    expect(row?.state).toBe("settled");
  });

  it("declines a payment the network refuses, raising one incident, without touching the sale", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    const ref = await acceptOfflineAndAssociate(provider, s);
    provider.declineForwardFor(ref);
    const result = await provider.forward(new Date());
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", ref));
    expect(row?.state).toBe("declined");
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
  });

  it("is idempotent — a second forward advances nothing and raises no duplicate incident", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db, s.tenantId);
    const ref = await acceptOfflineAndAssociate(provider, s);
    provider.declineForwardFor(ref);
    await provider.forward(new Date());
    const second = await provider.forward(new Date());
    expect(second).toMatchObject({ forwarded: 0, declined: 0, incidentsRaised: 0 });
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
  });

  it("returns all-zeros when there is nothing to forward", async () => {
    // A real seeded tenant, not a random id: the claim must come back empty because this tenant's
    // QUEUE is empty, which is what the fake's forward is being asked about — a tenant that cannot
    // own rows at all would assert the same thing against a broken claim predicate.
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db, s.tenantId);
    const result = await provider.forward(new Date());
    expect(result).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  });
});
