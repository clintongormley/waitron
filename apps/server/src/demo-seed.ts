import type { Database } from "@waitron/db";
import { getCountryPack } from "@waitron/country-packs";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { seedDemoRestaurant } from "../scripts/demo-seed/seed.js";
import type { SeedLocale } from "../scripts/demo-seed/menu.js";
import { demoDataSet } from "../scripts/demo-seed/data-set.js";

/** Public Demo starts with one month of deterministic practice sales and the full sample restaurant. */
export const INSTALLED_DEMO_SALES_DAYS = 30;

/** The staff language of an installed demo: Spanish when the person setting it up uses Spanish. */
export function demoSeedLocale(venue: VenueRequest): SeedLocale {
  return venue.admin.locale?.toLowerCase().startsWith("es") === true ? "es" : "en";
}

/** Add sample catalogues, floor, staff, media and practice sales to a freshly provisioned Demo. */
export async function seedInstalledDemo(
  db: Database,
  result: VenueResult,
  venue: VenueRequest,
): Promise<void> {
  const identity = getCountryPack(venue.country)?.demo;
  if (identity === undefined) {
    throw new Error(`seedInstalledDemo: the ${venue.country} country pack has no demo identity`);
  }
  await seedDemoRestaurant(db, {
    venue: {
      nodeId: result.nodeId,
      seriesId: result.seriesIds[0]!,
      locationId: result.locationId,
    },
    locale: demoSeedLocale(venue),
    salesDays: INSTALLED_DEMO_SALES_DAYS,
    departmentTradingNames: identity.departmentTradingNames,
    dataSet: demoDataSet(identity.dataSet),
  });
}
