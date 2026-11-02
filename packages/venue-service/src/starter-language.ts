import {
  resolveInstalledStarterLanguages,
  type StarterStaffLanguage,
} from "@waitron/country-packs";
import { readTenant, readVenue, type Transaction } from "@waitron/db";
import type { VenueScope } from "./operations.js";

/** A database with no tenant row still reads the receipt language. */
export async function readStarterStaffLanguage(
  tx: Transaction,
  _cfg: VenueScope,
): Promise<StarterStaffLanguage> {
  const venue = await readVenue(tx);
  const tenant = await readTenant(tx);
  return resolveInstalledStarterLanguages({
    country: tenant?.country,
    area: venue.province,
    receiptLocale: venue.invoiceLocales[0],
  }).staffLanguage;
}
