import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalRecordRef, SaleForFiscalRecord, TrustedClock } from "@waitron/fiscal";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "./operations.js";
import { createLabel, setProductLabels } from "./labels.js";
import { createUnit } from "./units.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { priceBasket } from "./pricing.js";
import { customerPresentationText } from "./product-presentation.js";
import { seedVenue } from "../test/fixtures.js";

/**
 * The end-to-end proof of the catalogue slice's central seam: catalogue data alone → the sale's
 * lines, `total` and VAT breakdown. It seeds a venue and a catalogue, reads the sellable products
 * with `listAvailableProducts`, prices a basket with `priceBasket`, and hands the resulting
 * `{ lines, total, vatBreakdown }` straight to `@waitron/core`'s `recordSale`. Nothing here computes
 * a price or a breakdown by hand — every fiscal figure originates in the catalogue.
 *
 * This suite proves the DATA FLOW across three packages. A `FakeFiscalBackend` stands in for the
 * regime backend.
 */
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  // `FakeFiscalBackend.recordSale`/`registerNode` read and write their own
  // `fake_node_registrations`/`fake_fiscal_records` tables, and nothing creates those tables except
  // this call.
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

/**
 * A `FakeFiscalBackend` that records the `SaleForFiscalRecord` its `recordSale` was last handed, so
 * the test can assert on the total and breakdown that actually crossed the fiscal boundary.
 *
 * The base `FakeFiscalBackend` does not persist `vatBreakdown` at all. A subclass adding the capture
 * is used rather than an object spread of an instance: `{ ...fake }` produces an object with NONE of
 * the interface's methods, because they are non-enumerable prototype methods.
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
 * `anchor`/`currentAnchor`, so both are stubs.
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
    const { locationId, tillId, nodeId, seriesId } = await seedVenue(suite.db);
    const backend = new CapturingFakeBackend(suite.db);

    let priced: ReturnType<typeof priceBasket>;

    const { saleId } = await withTransaction(suite.db, async (tx) => {
      await backend.registerNode(tx, nodeId);

      // Seed a catalogue: one weight-priced product ("sliced ham") in a "Food" category. English
      // strings only — this is a generic package under the english-only guard.
      const cat = await createCatalogue(tx, { name: "Deli" });
      const food = await createCategory(tx, { name: { en: "Food" } });
      const kgUnitId = (
        await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en")
      ).id;
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: food.id,
        name: "sliced ham",
        unitId: kgUnitId,
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      // A label never implies a category: the sale line still records Food.
      const breakfast = await createLabel(tx, "Breakfast");
      await setProductLabels(tx, product.id, [breakfast.id]);
      await assignCatalogueToLocation(tx, locationId, cat.id);

      // The till's read → pricing → fiscal write, all from catalogue data. An `AvailableProduct` is
      // NOT a `PriceableProduct`: it carries the staff `name` and the customer-facing `customerName`,
      // so the customer text is resolved through `product-presentation.ts` first — the one home for
      // the blank-falls-back-to-the-staff-name rule.
      const available = (await listAvailableProducts(tx, locationId)).products;
      expect(available.map((row) => row.id)).toEqual([product.id]);
      const [ham] = available;
      expect(ham).toBeDefined();
      const descriptions = customerPresentationText(
        {
          name: ham!.name,
          customerName: ham!.customerName,
          kitchenName: null,
          variantName: null,
          variantCustomerName: null,
          variantKitchenName: null,
        },
        "en",
      ).product;
      priced = priceBasket([{ product: { ...ham!, descriptions }, quantity: "0.320" }]);

      // Checkable by hand: 24.90/kg × 0.320 kg = 7.968 → 7.97 gross; at the reduced 10% rate the
      // gross-inclusive DIFFERENCE method gives base 7.25 and tax 0.72 (7.97 − 7.25), NOT the 0.73
      // that `base × rate` would produce — the distinction this seam must carry verbatim.
      expect(priced.total).toBe("7.97");

      return recordSale(tx, backend, {
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

    // The backend received the pricing's own `total` and breakdown VERBATIM — recordSale filed the
    // supplied difference-method breakdown rather than re-deriving one from `lines`. (If recordSale
    // ignored the supplied breakdown and derived its own, the captured tax would be 0.73, not 0.72,
    // and this `toEqual` would fail.)
    expect(backend.lastSale).toBeDefined();
    expect(backend.lastSale!.total).toBe(priced!.total);
    expect(backend.lastSale!.vatBreakdown).toEqual(priced!.vatBreakdown);

    // The sale was actually chained (the fake wrote its own record), and the line's analytics
    // category was snapshotted onto `sale_lines.category` from the catalogue product's resolved
    // category name.
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
    // The staff name reaches `sale_lines.name` (NOT NULL) frozen from the catalogue row, and the
    // customer-facing snapshot falls back to it because this product carries no customer name.
    // `descriptions` comes back as its stored TEXT here, not as an object: the json codec belongs
    // to the column declaration (`packages/db/src/schema/orders.ts`) and a raw `execute` never
    // reaches it.
    const { rows } = await suite.db.execute<{
      category: string | null;
      name: string;
      descriptions: string;
    }>(sql`select category, name, descriptions from sale_lines where sale_id = ${saleId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("Food");
    expect(rows[0]!.name).toBe("sliced ham");
    expect(JSON.parse(rows[0]!.descriptions)).toEqual({ en: "sliced ham" });
  });
});
