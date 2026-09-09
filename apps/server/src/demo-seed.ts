import type { Database } from "@waitron/db";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { seedDemoRestaurant } from "../scripts/demo-seed/seed.js";
import type { SeedLocale } from "../scripts/demo-seed/menu.js";

/** Public Demo starts with one month of deterministic practice sales and the full sample restaurant. */
export const INSTALLED_DEMO_SALES_DAYS = 30;

/** Choose the seed's authored language from the venue's primary invoice locale. */
export function demoSeedLocale(venue: VenueRequest): SeedLocale {
  return venue.location.invoiceLocales[0]?.toLowerCase().startsWith("es") === true ? "es" : "en";
}

/** Add sample catalogues, floor, staff, media and practice sales to a freshly provisioned Demo. */
export async function seedInstalledDemo(
  db: Database,
  result: VenueResult,
  venue: VenueRequest,
): Promise<void> {
  await seedDemoRestaurant(db, {
    venue: {
      tenantId: result.tenantId,
      tillId: result.tillId,
      nodeId: result.nodeId,
      seriesId: result.seriesIds[0]!,
      locationId: result.locationId,
    },
    locale: demoSeedLocale(venue),
    salesDays: INSTALLED_DEMO_SALES_DAYS,
  });
}
