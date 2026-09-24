import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  decimal,
  seriesId as brandSeriesId,
  nodeId as brandNodeId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS, associatePaymentWithSale, getPaymentByRef } from "@waitron/payments";
import { FakeStripe } from "./testing/fake-stripe.js";
import { StripeTerminalProvider } from "./provider.js";
import { freshNif, seedForSale } from "@waitron/payments/test/seed.js";
import type { SeededForSale } from "@waitron/payments/test/seed.js";
import { StripeReconciler, stripeReportClient, stripeSettlementReport } from "./index.js";
import type {
  StripeReconcileAccount,
  StripeReportClient,
  StripeSessionRef,
  StripeSettlement,
} from "./index.js";

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

function buildInput(
  s: SeededForSale,
  tender: { amount: string; settledAt: Date | null },
): RecordSaleInput {
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
      tenders: [
        { method: "card", amount: tender.amount, tipAmount: "0.00", settledAt: tender.settledAt },
      ],
    },
    clock: steadyClock,
  };
}

describe("stripe collect -> recordSale -> associate (the adapter seam, end to end)", () => {
  it("settles a Stripe tender, chains the sale, and associates the payment atomically", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new StripeTerminalProvider({
      client: new FakeStripe(),
      db: pg.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });

    const paid = await provider.collect({
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      readerRef: "reader_1",
    });
    expect(paid.provider).toBe("stripe");
    expect(paid.state).toBe("captured");
    expect(paid.settledAt).not.toBeNull();

    const saleId = await pg.db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid));
      await associatePaymentWithSale(tx, {
        provider: "stripe",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, {
        provider: "stripe",
        paymentRef: paid.paymentRef,
      }),
    );
    expect(row?.saleId).toBe(saleId);
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });
});

describe("stripe idempotency key is derived from the working order, decoupled from paymentRef", () => {
  // The key must be stable across retries so a lost-response re-tap re-drives the SAME
  // PaymentIntent. Real Stripe honouring the key is covered by collect.sandbox.test.ts.
  it("passes a stable wo-derived key across two collects for one working order, with distinct payment rows", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const client = new FakeStripe();
    const provider = new StripeTerminalProvider({
      client,
      db: pg.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const args = {
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      readerRef: "reader_1",
    };

    const first = await provider.collect(args);
    const firstKey = client.lastCreateIntent?.idempotencyKey;
    const second = await provider.collect(args);
    const secondKey = client.lastCreateIntent?.idempotencyKey;

    // The Stripe key is DERIVED FROM THE WORKING ORDER and identical across retries...
    expect(firstKey).toBe(`wo_${s.workingOrderId}`);
    expect(secondKey).toBe(firstKey);
    // ...while the LOCAL payment_ref stays random (one payments-row idempotency anchor per attempt).
    expect(second.paymentRef).not.toBe(first.paymentRef);
    expect(firstKey).not.toBe(first.paymentRef);
    expect(secondKey).not.toBe(second.paymentRef);
  });
});

// Every other test imports the reconcile surface from a deep path, so none of them would catch a
// re-export deleted from `./index.ts`.
describe("package public surface (./index.js) — the reconcile surface", () => {
  it("re-exports the reconcile surface's functions from the package root", () => {
    // Vitest strips types without typechecking, so only a runtime binding like these three can fail
    // this suite when dropped from the barrel.
    expect(typeof StripeReconciler).toBe("function");
    expect(typeof stripeSettlementReport).toBe("function");
    expect(typeof stripeReportClient).toBe("function");
  });

  it("types the report-client shapes and StripeReconcileAccount from the root barrel", () => {
    // Type-only exports: a deleted re-export fails `pnpm typecheck`, not this assertion. The
    // annotations below make that typecheck read the ROOT barrel rather than a deep path.
    const settlement: StripeSettlement = {
      paymentIntentId: "pi_1",
      chargeId: "ch_1",
      amountMinor: 1000,
      settledAt: new Date("2026-07-25T00:00:00Z"),
    };
    const session: StripeSessionRef = { sessionId: "cs_1", paymentIntentId: "pi_1" };
    const report: StripeReportClient = {
      listSettlements: () => Promise.resolve([settlement]),
      listCheckoutSessions: () => Promise.resolve([session]),
      paymentIntentForSession: () => Promise.resolve(null),
    };
    // `StripeRefunder` is not barrel-exported, so it is satisfied structurally rather than named.
    const account: StripeReconcileAccount = { report, refund: new FakeStripe() };
    expect(account.report).toBe(report);
  });
});
