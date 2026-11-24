import { listAdminHolders } from "@waitron/identity";
import { readIssueZone } from "@waitron/fiscal";
import { readBusinessDayScheduleRevision } from "@waitron/venue-service";
// Sales are seeded after the main transaction commits, because each sale opens its own transaction
// and reads the committed products.

import { and, eq } from "drizzle-orm";
import { deviceProfiles, floorZones, readVenueClock, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { validateCapabilities } from "@waitron/layouts";
import { replaceZoneClosedWeek, saveSpecialDay, venueLocalMoment } from "@waitron/venue-service";
import type { CountryDemoIdentity } from "@waitron/country";
import { createPrinter } from "@waitron/printing";
import {
  buildMenuDocument,
  listAvailableProducts,
  menuDocumentHash,
  menuItems,
  publishMenu,
  readContentLanguages,
  readReceiptLanguage,
  readTakeawayVatSchedules,
} from "@waitron/menu";
import { seedMenus } from "./seed-menus.js";
import { seedCourses } from "./seed-courses.js";
import { seedFloor } from "./seed-floor.js";
import { seedStaff } from "./seed-staff.js";
import { seedAdjustmentReasons } from "./seed-adjustments.js";
import { seedMedia } from "./seed-media.js";
import { seedExtraLists } from "./seed-extra-lists.js";
import { seedOptionLists } from "./seed-option-lists.js";
import { demoSeedEnvironment, seedSales } from "./seed-sales.js";
import type { SeedSalesDeliProduct } from "./seed-sales.js";
import type { SeedLocale } from "./locale.js";
import { demoPlainText, type DemoDataSet } from "./data-set.js";
import { DEMO_PRINTER_KEY, routeToDemoPrinter } from "../../src/demo-printer.js";

/** `seriesId` is the standard series, the first of `applyVenue`'s `seriesIds`. */
export interface SeedDemoVenue {
  nodeId: string;
  seriesId: string;
  operationDescription: string;
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
  demoSeedEnvironment(process.env);
  await withTransaction(db, (tx) => readIssueZone(tx, { nodeId: venue.nodeId }));

  const seeded = await withTransaction(db, async (tx) => {
    const courseIds = await seedCourses(tx, dataSet);
    const { productsByImage, menuIds, stationIds, deliListed } = await seedMenus(tx, {
      locale,
      dataSet,
      courseIds,
    });
    const { languages } = await readContentLanguages(tx, locale);
    const demoPrinter = await createPrinter(tx, {
      name: demoPlainText(dataSet.printerName, dataSet, locale),
      transport: "usb",
      localKey: DEMO_PRINTER_KEY,
      hasCashDrawer: true,
    });
    await routeToDemoPrinter(tx, demoPrinter.id);
    await seedOptionLists(tx, { productsByImage, locale, dataSet, languages });
    await seedExtraLists(tx, { productsByImage, locale, dataSet, languages });
    await seedFloor(tx, { locale, departmentTradingNames, dataSet, menuIds, deliListed });
    await giveKitchenDisplaysThePass(tx);
    await seedStaff(tx, { dataSet, locale });
    await seedAdjustmentReasons(tx, { locale, dataSet, languages });
    await seedMedia(tx, { productsByImage, mediaDataSet: dataSet.mediaDataSet });
    const [administrator] = await listAdminHolders(tx);
    if (administrator === undefined) throw new Error("seedDemoRestaurant: no administrator");
    // Publish after modifiers and media so each version freezes their seeded values.
    for (const menuId of Object.values(menuIds)) {
      const { document } = await buildMenuDocument(tx, menuId);
      await publishMenu(tx, menuId, menuDocumentHash(document), administrator.id);
    }
    const deliItems = await tx
      .select({ productId: menuItems.productId })
      .from(menuItems)
      .where(eq(menuItems.menuId, menuIds.deli));
    const { products } = await listAvailableProducts(tx);
    return {
      products,
      takeawayVatSchedules: await readTakeawayVatSchedules(
        tx,
        products.map((product) => product.id),
      ),
      deliProductIds: new Set(deliItems.map((item) => item.productId)),
      invoiceLocale: (await readReceiptLanguage(tx)).locale,
      passStationIds: { kitchen: stationIds.kitchen, deli: stationIds.deli },
    };
  });
  const { products, takeawayVatSchedules, deliProductIds, invoiceLocale, passStationIds } = seeded;

  const takeawayVatRateOf = (productId: string): string => {
    const schedule = takeawayVatSchedules.get(productId);
    if (schedule?.length !== 1 || schedule[0]!.from !== null)
      throw new Error(`seedDemoRestaurant: product ${productId} has no single takeaway rate`);
    return schedule[0]!.rate;
  };
  const salesProducts: SeedSalesDeliProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    customerName: p.customerName,
    unitPrice: p.unitPrice,
    vatClass: p.vatClass,
    takeawayVatClass: p.takeawayVatClass,
    takeawayVatRate: takeawayVatRateOf(p.id),
  }));
  // Products can share a `created_at` (all do under a frozen clock) and then sort by their IDs, so
  // read order can vary between runs, while seedSales draws by position: sort by everything a sale
  // line reads.
  const saleKey = (p: SeedSalesDeliProduct) =>
    JSON.stringify([
      p.name,
      p.customerName,
      p.unitPrice,
      p.vatClass,
      p.takeawayVatClass ?? null,
      p.takeawayVatRate,
    ]);
  salesProducts.sort((a, b) => {
    const [x, y] = [saleKey(a), saleKey(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });

  await seedSales(db, {
    venue: {
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
      operationDescription: venue.operationDescription,
    },
    invoiceLocale,
    days: salesDays,
    products: salesProducts,
    deliProducts: salesProducts.filter((product) => deliProductIds.has(product.id)),
  });

  // Install zone restrictions only after practice sales finish.
  await withTransaction(db, async (tx) => {
    const terrace = dataSet.floor.zones.find((zone) => zone.key === "terrace")!;
    const [zone] = await tx
      .select({ id: floorZones.id })
      .from(floorZones)
      .where(and(eq(floorZones.name, demoPlainText(terrace.name, dataSet, locale))));
    if (zone === undefined) throw new Error("seedDemoRestaurant: no Terrace zone");
    const clock = await readVenueClock(tx);
    const ranges =
      clock.dayCutover < "05:00" || clock.dayCutover > "23:00"
        ? [
            { startsAt: "23:00", endsAt: clock.dayCutover },
            { startsAt: clock.dayCutover, endsAt: "05:00" },
          ]
        : [{ startsAt: "23:00", endsAt: "05:00" }];
    await replaceZoneClosedWeek(
      tx,
      zone.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges,
      })),
      await readBusinessDayScheduleRevision(tx),
    );
    const at = new Date();
    const year = venueLocalMoment(at, clock)!.civilDate.slice(0, 4);
    await saveSpecialDay(
      tx,
      null,
      {
        name: demoPlainText(dataSet.specialDayName, dataSet, locale),
        repeatsYearly: true,
        dates: [{ date: `${year}-12-25`, closedAllDay: true }],
      },
      at,
      await readBusinessDayScheduleRevision(tx),
    );
  });
  return { passStationIds };
}
