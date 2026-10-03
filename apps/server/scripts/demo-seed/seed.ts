// Sales are seeded after the main transaction commits, because each sale opens its own transaction
// and reads the committed products.

import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  buildMenuDocument,
  listAvailableProducts,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedFloor } from "./seed-floor.js";
import { seedWatchers } from "./seed-watchers.js";
import { seedStaff } from "./seed-staff.js";
import { seedAdjustmentReasons } from "./seed-adjustments.js";
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
    const { productsByImage, menuIds, stationIds } = await seedCatalogues(tx, {
      locationId,
      locale,
    });
    await seedOptionLists(tx, { productsByImage, locale });
    await seedFloor(tx, { locationId, locale, menuIds });
    await seedWatchers(tx, { locationId, locale, stationIds });
    await seedStaff(tx);
    await seedAdjustmentReasons(tx, { locale });
    await seedMedia(tx, { productsByImage });
    // Published last, so each live version holds the option lists and photos above (D17).
    for (const menuId of Object.values(menuIds)) {
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "demo-seed");
    }
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
