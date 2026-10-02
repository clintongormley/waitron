// No `import "./errors.js"`: this file throws no AppError code.
import { eq } from "drizzle-orm";
import {
  locations,
  readTenant,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { ReceiptLanguageRules } from "@waitron/country";
import {
  resolveInstalledContentLanguageRules,
  resolveInstalledCountryLocale,
  resolveInstalledReceiptLanguageRules,
} from "@waitron/country-packs";
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALE_CODES,
  type ContentLanguageRules,
  type SupportedLocale,
} from "@waitron/shared";

/** The venue's geography from its taxpayer and location rows, for a caller that has read them. */
export function geographyOf(
  taxpayer: { country: string | null } | null | undefined,
  location: { province: string | null } | null | undefined,
): { country: string | null; area: string | null } {
  return { country: taxpayer?.country ?? null, area: location?.province ?? null };
}

async function geographyIn(
  tx: Transaction,
  locationId: string,
): Promise<{ country: string | null; area: string | null }> {
  const t = await readTenant(tx);
  const [loc] = await tx
    .select({ province: locations.province })
    .from(locations)
    .where(eq(locations.id, locationId));
  return geographyOf(t, loc);
}

function readVenueGeography(
  db: Database,
  locationId: string,
): Promise<{ country: string | null; area: string | null }> {
  return withTransaction(db, (tx) => geographyIn(tx, locationId));
}

/**
 * The venue's default UI locale, from geography and an optional override, through the shared
 * `override → area → country → English` chain.
 *
 * This is a DISPLAY value, DELIBERATELY separate from the location's receipt language, which a sale
 * is filed and printed in. The `override` is the RAW `WAITRON_TILL_LOCALE`
 * (`cfg.localeOverride`), NOT the defaulted `cfg.locale`, whose `es-ES` default would mask the
 * geography derivation.
 */
export async function readVenueLocale(
  db: Database,
  params: { locationId: string; override?: string },
): Promise<SupportedLocale> {
  const { country, area } = await readVenueGeography(db, params.locationId);
  return resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
    override: params.override,
    area,
    country,
    fallback: FALLBACK_LOCALE,
  });
}

/** The content languages the venue's region requires, from its country pack. */
export async function readVenueContentLanguageRules(
  db: Database,
  params: { locationId: string },
): Promise<ContentLanguageRules> {
  return resolveInstalledContentLanguageRules(await readVenueGeography(db, params.locationId));
}

/** The receipt languages the venue's country pack offers, and the one its region fixes, if any,
 * read in the caller's transaction. */
export async function readVenueReceiptLanguageRules(
  tx: Transaction,
  params: { locationId: string },
): Promise<ReceiptLanguageRules> {
  return resolveInstalledReceiptLanguageRules(await geographyIn(tx, params.locationId));
}
