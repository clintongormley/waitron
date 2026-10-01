// No `import "./errors.js"`: this file throws no AppError code.
import { eq } from "drizzle-orm";
import { locations, readTenant, withTransaction, type Database } from "@waitron/db";
import {
  resolveInstalledContentLanguageRules,
  resolveInstalledCountryLocale,
} from "@waitron/country-packs";
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALE_CODES,
  type ContentLanguageRules,
  type SupportedLocale,
} from "@waitron/shared";

async function readVenueGeography(
  db: Database,
  locationId: string,
): Promise<{ country: string | null; area: string | null }> {
  return withTransaction(db, async (tx) => {
    const t = await readTenant(tx);
    const [loc] = await tx
      .select({ province: locations.province })
      .from(locations)
      .where(eq(locations.id, locationId));
    return { country: t?.country ?? null, area: loc?.province ?? null };
  });
}

/**
 * The venue's default UI locale, from geography and an optional override, through the shared
 * `override → area → country → English` chain.
 *
 * This is a DISPLAY value, DELIBERATELY separate from the fiscal `cfg.locale` / `cfg.invoiceLocales`
 * that feed receipt and invoice rendering. The `override` is the RAW `WAITRON_TILL_LOCALE`
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
