import { eq } from "drizzle-orm";
import {
  resolveInstalledStarterLanguages,
  type StarterStaffLanguage,
} from "@waitron/country-packs";
import { locations, tenants, type Transaction } from "@waitron/db";
import type { VenueScope } from "./operations.js";

/** Left-joined, so a database with no tenant row still reads the receipt language. */
export async function readStarterStaffLanguage(
  tx: Transaction,
  cfg: VenueScope,
): Promise<StarterStaffLanguage> {
  const [venue] = await tx
    .select({
      country: tenants.country,
      area: locations.province,
      invoiceLocales: locations.invoiceLocales,
    })
    .from(locations)
    .leftJoin(tenants, eq(tenants.id, 1))
    .where(eq(locations.id, cfg.locationId));
  return resolveInstalledStarterLanguages({
    country: venue?.country,
    area: venue?.area,
    receiptLocale: venue?.invoiceLocales[0],
  }).staffLanguage;
}
