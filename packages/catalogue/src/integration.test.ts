import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalRecordRef, SaleForFiscalRecord, TrustedClock } from "@waitron/fiscal";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "./operations.js";
import { priceBasket } from "./pricing.js";
import { seedVenue } from "../test/fixtures.js";

/**
 * The end-to-end proof of the catalogue slice's central seam: catalogue data alone → the sale's
 * lines, `total` and VAT desglose. It seeds a venue and a catalogue, reads the sellable products
 * with `listAvailableProducts`, prices a basket with `priceBasket`, and hands the resulting
 * `{ lines, total, vatBreakdown }` straight to `@waitron/core`'s `recordSale`. Nothing here computes
 * a price or a breakdown by hand — every fiscal figure originates in the catalogue and flows through
 * the two functions under Tasks 3 and 5.
 *
 * The dependency is one-directional: `@waitron/catalogue` depends on `@waitron/core`, and core never
 * imports catalogue (verified: `packages/core/package.json` names no `@waitron/catalogue`), so
 * importing `recordSale` here introduces no cycle.
 *
 * PGlite, not real Postgres: this suite proves the DATA FLOW across three packages, not any
 * PostgreSQL privilege semantics — the catalogue tables' grants are pinned by the privilege matrix
 * (`packages/fiscal-verifactu/src/privileges.expected.ts`) and the write path by `packages/core`'s
 * own suite. A `FakeFiscalBackend` stands in for the regime backend, exactly as `packages/core`'s own
 * `record-sale.test.ts` does; the real Veri*Factu chain is exercised by the runnable demo
 * (`apps/server/scripts/catalogue-demo.ts`) and by `packages/fiscal-verifactu`'s e2e suite.
 */
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS],
  // `FakeFiscalBackend.recordSale`/`registerNode` read and write their own
  // `fake_node_registrations`/`fake_fiscal_records` tables, and nothing creates those tables except
  // this call — the identical setup `packages/core`'s `record-sale.test.ts` performs.
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

/**
 * A `FakeFiscalBackend` that records the `SaleForFiscalRecord` its `recordSale` was last handed, so
 * the test can assert on the total and desglose that actually crossed the fiscal boundary.
 *
 * **Realisation of the brief's `fakeBackend.lastSale`.** The base `FakeFiscalBackend`
 * (`@waitron/fiscal/src/testing/fake-backend.js`) has no `lastSale` affordance and does not persist
 * `vatBreakdown` at all (its `fake_fiscal_records` table has no such column). A subclass adding the
 * capture is used rather than an object spread of an instance: `record-sale.test.ts` records that
 * `{ ...fake }` produces an object with NONE of the interface's methods, because they are
 * non-enumerable prototype methods — so a subclass overriding the one method is the working shape.
 */
class CapturingFakeBackend extends FakeFiscalBackend {
  lastSale: SaleForFiscalRecord | undefined;

  override async recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    this.lastSale = sale;
    return super.recordSale(tx, sale);
  }
}

/**
 * A fixed, confident clock. `recordSale` reads `now()` exactly once and never touches
 * `anchor`/`currentAnchor`, so both are stubs — the identical shape every clock literal in
 * `record-sale.test.ts` and the e2e fixtures documents.
 */
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-03-01T13:05:00+01:00"),
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("integration.test: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

describe("catalogue → priceBasket → recordSale (end-to-end)", () => {
  it("rings a sale entirely from catalogue data", async () => {
    const { tenantId, locationId, tillId, nodeId, seriesId } = await seedVenue(suite.db);
    const backend = new CapturingFakeBackend(suite.db);

    let priced: ReturnType<typeof priceBasket>;

    const { saleId } = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await backend.registerNode(tx, nodeId, { tenantId });

      // Seed a catalogue: one weight-priced product ("sliced ham") in a "Food" category. English
      // strings only — this is a generic package under the english-only guard.
      const cat = await createCatalogue(tx, tenantId, { name: "Deli" });
      const food = await createCategory(tx, tenantId, { name: "Food" });
      await createProduct(tx, tenantId, {
        catalogueId: cat.id,
        categoryId: food.id,
        descriptions: { en: "sliced ham" },
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      await assignCatalogueToLocation(tx, locationId, cat.id);

      // The till's read → pricing → fiscal write, all from catalogue data. `listAvailableProducts`'
      // `AvailableProduct` is fed straight into `priceBasket`, which only typechecks because it is
      // structurally assignable to `PriceableProduct` (Task 5).
      const [ham] = (await listAvailableProducts(tx, locationId)).products;
      expect(ham).toBeDefined();
      priced = priceBasket([{ product: ham!, quantity: "0.320" }]);

      // Checkable by hand: 24.90/kg × 0.320 kg = 7.968 → 7.97 gross; at the reduced 10% rate the
      // gross-inclusive DIFFERENCE method gives base 7.25 and tax 0.72 (7.97 − 7.25), NOT the 0.73
      // that `base × rate` would produce — the distinction this seam must carry verbatim.
      expect(priced.total).toBe("7.97");

      return recordSale(tx, backend, {
        tenantId,
        tillId,
        nodeId,
        seriesId,
        locale: "en",
        invoiceLocales: ["en"],
        clock,
        // Deferred: no tenders, so the test needs no settlement wiring and stays on the seam it is
        // about (the invoice is the fiscal event; payment is separate).
        settlement: { kind: "deferred" },
        total: priced.total,
        lines: priced.lines,
        vatBreakdown: priced.vatBreakdown,
      });
    });

    // The backend received the pricing's own `total` and desglose VERBATIM — recordSale filed the
    // supplied difference-method breakdown rather than re-deriving one from `lines`. (If recordSale
    // ignored the supplied breakdown and derived its own, the captured tax would be 0.73, not 0.72,
    // and this `toEqual` would fail — the RED this seam is proven against.)
    expect(backend.lastSale).toBeDefined();
    expect(backend.lastSale!.total).toBe(priced!.total);
    expect(backend.lastSale!.vatBreakdown).toEqual(priced!.vatBreakdown);

    // The sale was actually chained (the fake wrote its own record), and the line's analytics
    // category was snapshotted onto `sale_lines.category` from the catalogue product's resolved
    // category name.
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
    const { rows } = await suite.db.execute<{ category: string | null }>(
      sql`select category from sale_lines where sale_id = ${saleId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("Food");
  });
});
