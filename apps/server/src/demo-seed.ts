import { type Database } from "@waitron/db";
import { venueFiscalSelection, type VenueRequest, type VenueResult } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { seedDemoRestaurant } from "../scripts/demo-seed/seed.js";
import type { SeedLocale } from "../scripts/demo-seed/locale.js";
import { readDemoSeedSelection } from "../scripts/demo-seed/data-set.js";

/** Public Demo starts with one month of deterministic practice sales and the full sample restaurant. */
export const INSTALLED_DEMO_SALES_DAYS = 30;

export function demoSeedLocale(venue: VenueRequest): SeedLocale {
  return (
    venue.staffLanguage ??
    (venue.admin.locale?.toLowerCase().startsWith("es") === true ? "es" : "en")
  );
}

/** Add sample menus, floor, staff, media and practice sales to a freshly provisioned Demo. */
export async function seedInstalledDemo(
  db: Database,
  result: VenueResult,
  venue: VenueRequest,
): Promise<void> {
  const { identity, dataSet } = await readDemoSeedSelection(db);
  await seedDemoRestaurant(db, {
    venue: {
      operationDescription:
        venueFiscalSelection(ALL_MODULES, venue.fiscalTerritory).contribution?.venueFields?.defaults
          ?.operationDescription ?? "",
      nodeId: result.nodeId,
      seriesId: result.seriesIds[0]!,
    },
    // A pack with no data set of its own gets English staff names (owner decision, W109 plan).
    locale: identity.dataSet === undefined ? "en" : demoSeedLocale(venue),
    salesDays: INSTALLED_DEMO_SALES_DAYS,
    departmentTradingNames: identity.departmentTradingNames,
    dataSet,
  });
}
