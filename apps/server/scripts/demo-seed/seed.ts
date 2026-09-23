// Seed catalogue, floor, staff and media in one app-role transaction. Seed sales after it commits
// because each sale opens its own transaction and reads the committed products.
// Image bytes share the database transaction. Fiscal sales are preproduction.

import { asAppUser, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { listAvailableProducts } from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedFloor } from "./seed-floor.js";
import { seedStaff } from "./seed-staff.js";
import { seedMedia } from "./seed-media.js";
import { seedOptionLists } from "./seed-option-lists.js";
import { seedSales } from "./seed-sales.js";
import type { SeedSalesProduct } from "./seed-sales.js";
import type { SeedLocale } from "./menu.js";

/** The provisioned venue's ids the orchestrator threads into the sub-seeds — the shape `applyVenue`
 *  returns (with `seriesId` picked from its `seriesIds`, the standard series being first). */
export interface SeedDemoVenue {
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

export interface SeedDemoInput {
  venue: SeedDemoVenue;
  /** The BARE content locale every menu/floor/status is authored under; each sale is filed under the
   *  FULL tag it maps to (`SEED_INVOICE_LOCALE`) — content authored bare, filed full (feature B). */
  locale: SeedLocale;
  /** How many trailing days of historical sales to back-fill. `0` seeds no sales (the catalogue,
   *  floor, staff and media still seed). */
  salesDays: number;
}

/**
 * Seed the whole demo restaurant onto an already-provisioned venue: catalogues, floor, staff and
 * media inside one transaction, then the historical sales on their own.
 */
export async function seedDemoRestaurant(
  db: Database,
  { venue, locale, salesDays }: SeedDemoInput,
): Promise<void> {
  const { locationId } = venue;

  // One tx for every in-transaction sub-seed. `listAvailableProducts` is read at
  // the end, inside the SAME tx, so the sales generator draws from exactly what was just seeded.
  const products = await withTransaction(db, async (tx) => {
    await asAppUser(tx);
    const { productsByImage, menuIds } = await seedCatalogues(tx, {
      locationId,
      locale,
    });
    await seedOptionLists(tx, { productsByImage, locale });
    await seedFloor(tx, { locationId, locale, menuIds });
    await seedStaff(tx);
    await seedMedia(tx, { productsByImage });
    return (await listAvailableProducts(tx, locationId)).products;
  });

  // AFTER the tx commits: seedSales opens its own per-sale `withTransaction`, so it must see the committed
  // catalogue. It maps the available products onto the fields the generator needs (id/name/customerName/
  // gross unitPrice/vatClass); the rest of `AvailableProduct` is unused here.
  const salesProducts: SeedSalesProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    customerName: p.customerName,
    unitPrice: p.unitPrice,
    vatClass: p.vatClass,
  }));

  await seedSales(db, {
    venue: {
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
    },
    locale,
    days: salesDays,
    products: salesProducts,
  });
}
