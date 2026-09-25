// Sales are seeded after the main transaction commits, because each sale opens its own transaction
// and reads the committed products.

import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { listAvailableProducts } from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedFloor } from "./seed-floor.js";
import { seedStaff } from "./seed-staff.js";
import { seedMedia } from "./seed-media.js";
import { seedOptionLists } from "./seed-option-lists.js";
import { demoSeedEnvironment, seedSales } from "./seed-sales.js";
import type { SeedSalesProduct } from "./seed-sales.js";
import type { SeedLocale } from "./menu.js";

/** `seriesId` is the standard series, the first of `applyVenue`'s `seriesIds`. */
export interface SeedDemoVenue {
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

export interface SeedDemoInput {
  venue: SeedDemoVenue;
  locale: SeedLocale;
  /** `0` seeds no sales; everything else still seeds. */
  salesDays: number;
}

export async function seedDemoRestaurant(
  db: Database,
  { venue, locale, salesDays }: SeedDemoInput,
): Promise<void> {
  const { locationId } = venue;
  demoSeedEnvironment(process.env);

  const products = await withTransaction(db, async (tx) => {
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
