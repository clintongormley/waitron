import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  nodeId as brandNodeId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
// The subpath `@waitron/fiscal/src/testing/fake-backend.js` is the exact test-only entry
// `packages/core`'s own `record-sale.test.ts` (and `payments`'s wiring test) import the fake by —
// there is no `@waitron/fiscal/testing` export. Mirrored verbatim.
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

// The adapter capstone: it composes the REAL pieces end to end — a Stripe Terminal payment settles a
// tender via `StripeTerminalProvider.collect` (driven by `FakeStripe`), `@waitron/core`'s
// `recordSale` chains the sale through `FakeFiscalBackend`, and `associatePaymentWithSale` links the
// payment to the committed sale IN THE SAME TRANSACTION as the sale, so the linkage is atomic. The
// mirror of `packages/payments/src/wiring.test.ts`'s first test, but through the real Stripe adapter:
// the row must carry `provider='stripe'`, `state='captured'`, the committed `sale_id`, and a `pi_`
// `external_ref` (the PaymentIntent id).

// The setup step creates the fake backend's own `fake_node_registrations`/`fake_fiscal_records`
// tables, exactly as `record-sale.test.ts` and the neutral wiring test do.
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});

// Each test seeds a FRESH tenant (its own till, series and working order) with a distinct NIF, so
// nothing is truncated between tests — the same per-test-fresh-tenant convention the neutral wiring
// test uses.

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** A `TrustedClock` built from `now()` alone — `recordSale` reads `now()` exactly once and never
 * calls `anchor`/`currentAnchor`, so both throw/return null. Reproduced locally (house convention),
 * mirroring the neutral wiring test's `steadyClock`. */
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

/** Builds the `RecordSaleInput` for one card sale of 12.10, taking the single tender's `amount`/
 * `settledAt` straight off the provider's `collect` result — so a captured result yields a settled
 * tender and the sale chains. Reproduced locally (house convention). */
function buildInput(
  s: SeededForSale,
  tender: { amount: string; settledAt: Date | null },
): RecordSaleInput {
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
    // Immediate settlement, tip on the tender (zero here): sum(amount) = total 12.10 + tip 0.00.
    settlement: {
      kind: "immediate",
      tenders: [
        { method: "card", amount: tender.amount, tipAmount: "0.00", settledAt: tender.settledAt },
      ],
    },
    fiscalBackend: "fake",
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
      tenantId: brandTenantId(s.tenantId),
      nodeId: "11111111-1111-4111-8111-111111111111",
      resolveReader: () => Promise.resolve("reader_1"),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });

    // 1. The Stripe payment settles the tender.
    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    });
    expect(paid.provider).toBe("stripe");
    expect(paid.state).toBe("captured");
    expect(paid.settledAt).not.toBeNull();

    // 2. The sale and the associate-back happen in ONE transaction, so the linkage is atomic with
    //    the sale it points at (the composite FK `payments_sale_fk` is satisfied within the tx
    //    because the sale row already exists there).
    const saleId = await pg.db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid));
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "stripe",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    // 3. After commit, the payment row carries the committed sale's id, the stripe provider, the
    //    captured state, and the PaymentIntent id in `external_ref`.
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, {
        tenantId: s.tenantId,
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
  // §4 (capture idempotency): the Stripe PaymentIntent-creation key must be STABLE across retries so
  // a lost-response re-tap re-drives the SAME PaymentIntent and Stripe charges once. It is derived
  // from `workingOrderId`, NOT from the per-call random `paymentRef` (which stays the `payments`
  // row's idempotency anchor, one row per attempt). `FakeStripe.lastCreateIntent` records the key the
  // provider handed Stripe, so this asserts the derivation on the hermetic target — the key is pure
  // logic (no RLS), so PGlite is the right target here (the wiring-test pattern), and the real SDK's
  // honouring of that key is the nightly sandbox suite's half (collect.sandbox.test.ts).
  it("passes a stable wo-derived key across two collects for one working order, with distinct payment rows", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const client = new FakeStripe();
    const provider = new StripeTerminalProvider({
      client,
      db: pg.db,
      tenantId: brandTenantId(s.tenantId),
      nodeId: "11111111-1111-4111-8111-111111111111",
      resolveReader: () => Promise.resolve("reader_1"),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const args = {
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
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
    // Prove the decoupling: the key is NOT either random ref.
    expect(firstKey).not.toBe(first.paymentRef);
    expect(secondKey).not.toBe(second.paymentRef);
  });
});

/**
 * A coherence check on the package root's Slice B (reconcile) surface — this package has no
 * `index.test.ts` yet, so this lives here per the brief's fallback. Every other test in this file
 * (and package) imports the reconcile surface from a deep path (`./reconciler.js`, `./report-client.js`,
 * `./stripe-report-client.js`), so none of them would catch a re-export deleted from `./index.ts`
 * itself. Mirrors `packages/payments/src/index.test.ts`'s own reasoning for its barrel check.
 */
describe("package public surface (./index.js) — the reconcile surface", () => {
  it("re-exports the reconcile surface's functions from the package root", () => {
    // Value exports: type-only checks are erased at runtime by esbuild (vitest does not run tsc), so
    // a dropped re-export would compile clean here and only fail `pnpm typecheck` for a TYPE. These
    // three are runtime bindings, and this `typeof` assertion is the only thing that would catch one
    // of them being dropped from the barrel.
    expect(typeof StripeReconciler).toBe("function");
    expect(typeof stripeSettlementReport).toBe("function");
    expect(typeof stripeReportClient).toBe("function");
  });

  it("types the report-client shapes and StripeReconcileAccount from the root barrel", () => {
    // All four are type-only exports, so the meaningful check is that `./index.ts`'s re-export still
    // type-checks against a value shaped by `./report-client.js`/`./reconciler.js` — a deleted
    // re-export fails this package's `pnpm typecheck`, not this assertion, but the annotations below
    // are what force that check to run against the ROOT barrel rather than a deep path. Without
    // `StripeReconcileAccount` specifically, a caller could satisfy `StripeReconcilerOptions.resolveAccount`
    // but could never NAME the type its own resolver has to return.
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
    // `StripeRefunder` is deliberately NOT barrel-exported (only the account composing it is), so
    // it's satisfied structurally here by `FakeStripe` (already used this way by reconciler.test.ts)
    // rather than named.
    const account: StripeReconcileAccount = { report, refund: new FakeStripe() };
    expect(account.report).toBe(report);
  });
});
