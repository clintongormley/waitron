import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  associatePaymentWithSale,
  expireInitiated,
  getPaymentByRef,
  resolvePaymentTenant,
  settleInitiated,
} from "./store.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// The Mode 3 capstone: it composes the REAL neutral pieces the way the (deferred) app-level webhook
// endpoint will — verify -> resolveTenant -> withTenant{ settleInitiated + recordSale + associate } —
// with no `apps/` layer. It is a second consumer of `@waitron/core` (a dev dependency), exactly like
// wiring.test.ts. `recordSale` runs INSIDE the same transaction as settle + associate, so the sale
// chains atomically with the tender settlement.

const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

function buildInput(s: SeededForSale, settledAt: Date | null): RecordSaleInput {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    nodeId: brandNodeId(s.nodeId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "12.10",
    lines: [
      {
        lineNo: 1,
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    // Immediate settlement, tip on the tender (zero here): sum(amount) 12.10 = total 12.10 + tip 0.00.
    // A null `settledAt` (redelivery/expiry paths never reach here) would make `settleSale` refuse it.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "12.10", tipAmount: "0.00", settledAt }],
    },
    clock: steadyClock,
  };
}

/** Plays the app-level orchestrator: verify the raw event, resolve the tenant untenanted, then in
 * ONE tenant-scoped transaction settle the tender, chain the sale, and associate. Returns the sale
 * id, or null when settleInitiated found nothing to advance (a redelivery — no sale is chained). */
async function orchestrate(
  provider: FakeAsyncProvider,
  backend: FakeFiscalBackend,
  s: SeededForSale,
  payload: string,
): Promise<string | null> {
  const event = provider.verifyAndParse(payload, "signature");
  if (event === null) return null;
  const tenantId = await resolvePaymentTenant(pg.db, event.provider, event.externalRef);
  if (tenantId === null) return null;
  return withTenant(pg.db, tenantId, async (tx) => {
    if (event.outcome === "expired") {
      await expireInitiated(tx, { provider: event.provider, externalRef: event.externalRef });
      return null;
    }
    const row = await settleInitiated(tx, {
      provider: event.provider,
      externalRef: event.externalRef,
      settledAt: event.settledAt,
    });
    if (row === null) return null; // redelivery — already chained; do nothing
    const recorded = await recordSale(tx, backend, buildInput(s, event.settledAt));
    await associatePaymentWithSale(tx, {
      tenantId,
      provider: event.provider,
      paymentRef: row.paymentRef,
      saleId: recorded.saleId,
    });
    return recorded.saleId;
  });
}

describe("initiate -> webhook -> settle -> recordSale -> associate (Mode 3, end to end)", () => {
  it("settles the hosted tender, chains the sale, and associates the payment atomically", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakeAsyncProvider(pg.db);

    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });

    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "settled",
      amount: "12.10",
      settledAt: BASE,
    });
    const saleId = await orchestrate(provider, backend, s, payload);
    expect(saleId).not.toBeNull();

    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.saleId).toBe(saleId);
  });

  it("is idempotent under a redelivered webhook: the second delivery chains no second sale", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakeAsyncProvider(pg.db);
    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "settled",
      amount: "12.10",
      settledAt: BASE,
    });

    const first = await orchestrate(provider, backend, s, payload);
    expect(first).not.toBeNull();
    const second = await orchestrate(provider, backend, s, payload); // at-least-once redelivery
    expect(second).toBeNull();

    // Exactly one sale exists for this tenant's till/series (invoice_number 1, never a second).
    const sales = await pg.db.execute<{ count: string }>(
      sql`select count(*)::text as count from sales where tenant_id = ${s.tenantId}`,
    );
    expect(sales.rows[0].count).toBe("1");
  });

  it("an expired hosted payment advances to failed, chains no sale, and leaves the working order open", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakeAsyncProvider(pg.db);
    const minted = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef: "pay-1",
    });
    const payload = FakeAsyncProvider.event({
      externalRef: minted.externalRef,
      outcome: "expired",
      amount: "12.10",
      settledAt: BASE,
    });

    const saleId = await orchestrate(provider, backend, s, payload);
    expect(saleId).toBeNull();

    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("failed");
    expect(row?.saleId).toBeNull();
    const sales = await pg.db.execute<{ count: string }>(
      sql`select count(*)::text as count from sales where tenant_id = ${s.tenantId}`,
    );
    expect(sales.rows[0].count).toBe("0");
  });
});
