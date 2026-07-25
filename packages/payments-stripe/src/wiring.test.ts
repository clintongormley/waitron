import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
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

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
  // Creates the fake backend's own `fake_till_registrations`/`fake_fiscal_records` tables, exactly
  // as `record-sale.test.ts` and the neutral wiring test do.
  await FakeFiscalBackend.install(db);
}, 60_000);

afterAll(async () => {
  await db.close();
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
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "12.10",
    tipAmount: "0.00",
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
    tenders: [{ method: "card", amount: tender.amount, settledAt: tender.settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

describe("stripe collect -> recordSale -> associate (the adapter seam, end to end)", () => {
  it("settles a Stripe tender, chains the sale, and associates the payment atomically", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    const provider = new StripeTerminalProvider({
      client: new FakeStripe(),
      db,
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
    const saleId = await db.transaction(async (tx) => {
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
    const row = await db.transaction((tx) =>
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
