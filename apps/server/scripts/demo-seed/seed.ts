// Sales are seeded after the main transaction commits, because each sale opens its own transaction
// and reads the committed products.

import { eq } from "drizzle-orm";
import { locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { CountryDemoIdentity } from "@waitron/country";
import { createPrinter } from "@waitron/printing";
import {
  buildMenuDocument,
  listAvailableProducts,
  menuDocumentHash,
  publishMenu,
  readContentLanguages,
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
import type { DemoDataSet } from "./data-set.js";
import { DEMO_PRINTER_KEY, routeToDemoPrinter } from "../../src/demo-printer.js";

/** `seriesId` is the standard series, the first of `applyVenue`'s `seriesIds`. */
export interface SeedDemoVenue {
  nodeId: string;
  seriesId: string;
  locationId: string;
}

export interface SeedDemoInput {
  venue: SeedDemoVenue;
  locale: SeedLocale;
  departmentTradingNames: CountryDemoIdentity["departmentTradingNames"];
  dataSet: DemoDataSet;
  /** `0` seeds no sales; everything else still seeds. */
  salesDays: number;
}

export async function seedDemoRestaurant(
  db: Database,
  { venue, locale, salesDays, departmentTradingNames, dataSet }: SeedDemoInput,
): Promise<void> {
  const { locationId } = venue;
  demoSeedEnvironment(process.env);

  const { products, invoiceLocale } = await withTransaction(db, async (tx) => {
    const { productsByImage, menuIds, stationIds } = await seedCatalogues(tx, {
      locationId,
      locale,
      dataSet,
    });
    const { languages } = await readContentLanguages(tx, locale);
    const demoPrinter = await createPrinter(
      tx,
      { locationId },
      {
        name: "Demo printer",
        transport: "usb",
        localKey: DEMO_PRINTER_KEY,
        hasCashDrawer: true,
      },
    );
    await routeToDemoPrinter(tx, locationId, demoPrinter.id);
    await seedOptionLists(tx, { productsByImage, locale, dataSet, languages });
    await seedFloor(tx, { locationId, locale, departmentTradingNames, dataSet, menuIds });
    await seedWatchers(tx, { locationId, locale, dataSet, stationIds });
    await seedStaff(tx, { dataSet });
    await seedAdjustmentReasons(tx, { locale, dataSet, languages });
    await seedMedia(tx, { productsByImage });
    // Published last, so each live version holds the option lists and photos above (D17).
    for (const menuId of Object.values(menuIds)) {
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "demo-seed");
    }
    const [location] = await tx
      .select({ invoiceLocales: locations.invoiceLocales })
      .from(locations)
      .where(eq(locations.id, locationId));
    return {
      products: (await listAvailableProducts(tx, locationId)).products,
      invoiceLocale: location!.invoiceLocales[0]!,
    };
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
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
    },
    invoiceLocale,
    days: salesDays,
    products: salesProducts,
  });
}
