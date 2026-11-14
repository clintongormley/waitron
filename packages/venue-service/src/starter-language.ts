import {
  resolveInstalledStarterLanguages,
  type StarterStaffLanguage,
} from "@waitron/country-packs";
import { readTaxpayer, readVenue, type Transaction } from "@waitron/db";

/** A database with no taxpayer row still reads the receipt language. */
export async function readStarterStaffLanguage(tx: Transaction): Promise<StarterStaffLanguage> {
  const venue = await readVenue(tx);
  const taxpayer = await readTaxpayer(tx);
  return resolveInstalledStarterLanguages({
    country: taxpayer?.country,
    area: venue.province,
    receiptLocale: venue.invoiceLocales[0],
  }).staffLanguage;
}
