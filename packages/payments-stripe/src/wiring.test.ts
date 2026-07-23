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
