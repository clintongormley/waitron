import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
// The subpath `@waitron/fiscal/src/testing/fake-backend.js` — not a `@waitron/fiscal/testing`
// export that does not exist — is the exact path `packages/core`'s own `record-sale.test.ts`
// imports the fake by, and the one `packages/fiscal/src/index.ts`'s own barrel comment names as
// the intended test-only entry. Mirrored verbatim.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { associatePaymentWithSale, getPaymentByRef } from "./store.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

// This is the capstone: it composes the REAL pieces end to end — a payment settles a tender via
// `FakePaymentProvider.collect`, `@waitron/core`'s `recordSale` chains the sale through
// `FakeFiscalBackend`, and `associatePaymentWithSale` links the payment to the committed sale IN
// THE SAME TRANSACTION as the sale, so the linkage is atomic. It is the first consumer of
// `@waitron/core` (a dev dependency) from this package.

// The core schema (tenants/locations/tills/invoice_series/sales/sale_lines/tenders) plus this
// package's own `payments`/`payment_refunds`. Both are needed: the payment rows and the sale
// rows both get written in this file. The setup step creates the fake backend's own
// `fake_till_registrations`/`fake_fiscal_records` tables. Without it `registerTill`/`recordSale`
// fail with "relation fake_fiscal_records does not exist" — the same install
// `record-sale.test.ts` performs.
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});

// Each test seeds a FRESH tenant (its own till, series and working order), so nothing is truncated
// between tests. Distinct NIFs keep those tenants collision-free against `tenants_nif_key`, and
// each fresh till keeps the fake's `fake_till_registrations` primary key collision-free — the same
// per-test-fresh-tenant convention `fake-provider.test.ts` uses. `freshNif` is shared from
// ../test/seed.js.

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * A `TrustedClock` built from `now()` alone. `recordSale` reads `now()` exactly once and never
 * calls `anchor`/`currentAnchor`, so both are stubbed — mirroring `record-sale.test.ts`'s own
 * `fixedClock`, whose full `TrustedClock` interface (`packages/fiscal/src/clock.ts`) requires them.
 */
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

/**
 * Builds the `RecordSaleInput` for one card sale of 12.10, taking the single tender's `amount`/
 * `settledAt` straight off the provider's `collect` result — so a captured result yields a settled
 * tender (the sale chains) and a failed result yields an unsettled one (`recordSale` refuses). The
 * plain-string seed ids are branded here at the call site, exactly as `fake-provider.test.ts`
 * brands them for `collect`.
 */
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
    // total is the taxable amount and tip is zero here, so amount_charged (12.10) equals the one
    // tender — satisfying both the sale's `amount_charged = total + tip` check and the deferred
    // `sales_assert_tenders_cover` trigger at commit.
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

describe("collect -> recordSale -> associate (the payment seam, end to end)", () => {
  it("settles a tender, chains the sale, and associates the payment atomically", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakePaymentProvider(pg.db, s.tenantId);

    // 1. The payment settles the tender.
    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    });
    expect(paid.state).toBe("captured");
    expect(paid.settledAt).not.toBeNull();

    // 2. The sale and the associate-back happen in ONE transaction, so the linkage is atomic with
    //    the sale it points at (the composite FK `payments_sale_fk` is satisfied within the tx
    //    because the sale row already exists there).
    const saleId = await pg.db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid));
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "fake",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    // 3. After commit, the payment row carries the committed sale's id.
    const row = await pg.db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: paid.paymentRef }),
    );
    expect(row?.saleId).toBe(saleId);
    expect(row?.state).toBe("captured");
  });

  it("refuses the sale when the payment failed and leaves the tender unsettled", async () => {
    const backend = new FakeFiscalBackend(pg.db);
    const s = await seedForSale(pg.db, backend, freshNif());
    const provider = new FakePaymentProvider(pg.db, s.tenantId);
    provider.failNextCollect();

    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
    });
    expect(paid.state).toBe("failed");
    expect(paid.settledAt).toBeNull();

    // The unsettled tender (settledAt: null) makes `recordSale` refuse before it writes anything —
    // `assertAllTendersSettled` is its first statement, so the AppError propagates out of the
    // transaction directly (no Drizzle wrapper) and its `code` is asserted exactly as the sibling
    // core test does.
    await expect(
      pg.db.transaction((tx) => recordSale(tx, backend, buildInput(s, paid))),
    ).rejects.toMatchObject({ code: "sale.tender_unsettled" });
  });
});
