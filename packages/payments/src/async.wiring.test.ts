import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
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
  hasPaymentWithExternalRef,
  settleInitiated,
} from "./store.js";
import { FakeAsyncProvider } from "./testing/fake-async-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// Composes the real pieces as an app-level webhook endpoint would, with no `apps/` layer:
// verify -> hasPaymentWithExternalRef -> one transaction { settleInitiated + recordSale + associate }.

const pg = useVenueDb({
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
        name: "Item",
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "12.10", tipAmount: "0.00", settledAt }],
    },
    clock: steadyClock,
  };
}

/** Plays the app-level orchestrator: verify the raw event, check a local payment carries its
 * reference, then in ONE transaction settle the tender, chain the sale, and associate. Returns the sale
 * id, or null when settleInitiated found nothing to advance (a redelivery — no sale is chained). */
async function orchestrate(
  provider: FakeAsyncProvider,
  backend: FakeFiscalBackend,
  s: SeededForSale,
  payload: string,
): Promise<string | null> {
  const event = provider.verifyAndParse(payload, "signature");
  if (event === null) return null;
  if (!(await hasPaymentWithExternalRef(pg.db, event.provider, event.externalRef))) return null;
  return withTransaction(pg.db, async (tx) => {
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
      getPaymentByRef(tx, { provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.saleId).toBe(saleId);
  });

  it("is idempotent under a redelivered webhook: the second delivery chains no second sale", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakeAsyncProvider(pg.db);
    const minted = await provider.initiate({
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

    // Exactly one sale: invoice_number 1, never a second.
    const sales = await pg.db.execute<{ count: string }>(
      sql`select cast(count(*) as text) as count from sales`,
    );
    expect(sales.rows[0].count).toBe("1");
  });

  it("an expired hosted payment advances to failed, chains no sale, and leaves the working order open", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakeAsyncProvider(pg.db);
    const minted = await provider.initiate({
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
      getPaymentByRef(tx, { provider: "fake", paymentRef: "pay-1" }),
    );
    expect(row?.state).toBe("failed");
    expect(row?.saleId).toBeNull();
    const sales = await pg.db.execute<{ count: string }>(
      sql`select cast(count(*) as text) as count from sales`,
    );
    expect(sales.rows[0].count).toBe("0");
  });
});
