// Sales are seeded after the main transaction commits, because each sale opens its own transaction
// and reads the committed products.

import { and, eq } from "drizzle-orm";
import { deviceProfiles, floorZones, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { validateCapabilities } from "@waitron/layouts";
import { readLocationClock } from "@waitron/reporting";
import { replaceZoneClosedWeek } from "@waitron/venue-service";
import { locationId as brandLocationId } from "@waitron/shared";
import type { CountryDemoIdentity } from "@waitron/country";
import { createPrinter } from "@waitron/printing";
import {
  buildMenuDocument,
  listAvailableProducts,
  menuDocumentHash,
  publishMenu,
  readContentLanguages,
  readReceiptLanguage,
} from "@waitron/catalogue";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedFloor } from "./seed-floor.js";
import { seedStaff } from "./seed-staff.js";
import { seedAdjustmentReasons } from "./seed-adjustments.js";
import { seedMedia } from "./seed-media.js";
import { seedExtraLists } from "./seed-extra-lists.js";
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

/** The stations the demo's pass covers. */
export interface SeedDemoResult {
  passStationIds: { kitchen: string; deli: string };
}

/** The default kitchen display profile does not run the pass; the demo's does. */
async function giveKitchenDisplaysThePass(tx: Transaction): Promise<void> {
  const profiles = await tx
    .select({ id: deviceProfiles.id, capabilities: deviceProfiles.capabilities })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.formFactor, "kds"));
  for (const profile of profiles) {
    const capabilities = validateCapabilities(
      [...validateCapabilities(profile.capabilities), "run-the-pass"],
      "kds",
    );
    await tx.update(deviceProfiles).set({ capabilities }).where(eq(deviceProfiles.id, profile.id));
  }
}

export async function seedDemoRestaurant(
  db: Database,
  { venue, locale, salesDays, departmentTradingNames, dataSet }: SeedDemoInput,
): Promise<SeedDemoResult> {
  const { locationId } = venue;
  demoSeedEnvironment(process.env);

  const { products, invoiceLocale, passStationIds } = await withTransaction(db, async (tx) => {
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
    await seedExtraLists(tx, { productsByImage, locale, dataSet, languages });
    await seedFloor(tx, { locationId, locale, departmentTradingNames, dataSet, menuIds });
    await giveKitchenDisplaysThePass(tx);
    await seedStaff(tx, { dataSet });
    await seedAdjustmentReasons(tx, { locale, dataSet, languages });
    await seedMedia(tx, { productsByImage });
    // Publish after modifiers and media so each version freezes their seeded values.
    for (const menuId of Object.values(menuIds)) {
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), "demo-seed");
    }
    return {
      products: (await listAvailableProducts(tx, locationId)).products,
      invoiceLocale: (await readReceiptLanguage(tx, locationId)).locale,
      passStationIds: { kitchen: stationIds.kitchen, deli: stationIds.deli },
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

  // Install zone restrictions only after practice sales finish.
  await withTransaction(db, async (tx) => {
    const terrace = dataSet.floor.zones.find((zone) => zone.key === "terrace")!;
    const [zone] = await tx
      .select({ id: floorZones.id })
      .from(floorZones)
      .where(and(eq(floorZones.locationId, locationId), eq(floorZones.name, terrace.name[locale])));
    if (zone === undefined) throw new Error("seedDemoRestaurant: no Terrace zone");
    const { dayCutover } = await readLocationClock(tx, locationId);
    await replaceZoneClosedWeek(
      tx,
      { locationId: brandLocationId(locationId) },
      zone.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: [{ startsAt: "23:00", endsAt: dayCutover }],
      })),
    );
  });
  return { passStationIds };
}
