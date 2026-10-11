// No `import "./errors.js"`: this file throws no AppError code.
import { eq } from "drizzle-orm";
import {
  locations,
  readTenant,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { contentLanguagesOr, readSavedContentLanguages } from "@waitron/catalogue";
import type { ReceiptLanguageRules } from "@waitron/country";
import {
  resolveInstalledContentLanguageRules,
  resolveInstalledCountryLocale,
  resolveInstalledReceiptLanguageRules,
} from "@waitron/country-packs";
import {
  contentLanguageCode,
  FALLBACK_LOCALE,
  SUPPORTED_LOCALE_CODES,
  type ContentLanguageRules,
  type SupportedLocale,
} from "@waitron/shared";
import type { Logger } from "./logger.js";

async function countryIn(tx: Transaction): Promise<string | null> {
  return (await readTenant(tx))?.country ?? null;
}

async function geographyIn(
  tx: Transaction,
  locationId: string,
): Promise<{ country: string | null; area: string | null }> {
  const country = await countryIn(tx);
  const [loc] = await tx
    .select({ province: locations.province })
    .from(locations)
    .where(eq(locations.id, locationId));
  return { country, area: loc?.province ?? null };
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
 * This is a DISPLAY value, DELIBERATELY separate from the location's receipt language. The
 * `override` is the RAW `WAITRON_TILL_LOCALE` (`cfg.localeOverride`), NOT the defaulted
 * `cfg.locale`, whose `es-ES` default would mask the geography derivation.
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

/** The content languages the venue's country pack keeps enabled for its area. */
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

/**
 * The receipt languages staff may print in: `receiptLanguage` first, then each of `packChoices`
 * whose content-language code is one of `contentCodes`. Codes match exactly, so a Valencian
 * (`ca-ES-valencia`) content language does not offer `ca-ES`.
 */
export function offeredReceiptLanguages(
  receiptLanguage: string,
  packChoices: readonly string[],
  contentCodes: readonly string[],
): [string, ...string[]] {
  const offered: [string, ...string[]] = [receiptLanguage];
  for (const choice of packChoices) {
    if (!offered.includes(choice) && contentCodes.includes(contentLanguageCode(choice))) {
      offered.push(choice);
    }
  }
  return offered;
}

/** A location's receipt language (the first of its `invoice_locales`), the whole list, and its
 * province, in one read. */
async function locationLanguageIn(
  tx: Transaction,
  locationId: string,
): Promise<{ locale: string; invoiceLocales: string[]; area: string | null }> {
  const [row] = await tx
    .select({ invoiceLocales: locations.invoiceLocales, province: locations.province })
    .from(locations)
    .where(eq(locations.id, locationId));
  const locale = row?.invoiceLocales[0];
  // As `readReceiptLanguage` (@waitron/catalogue), with the province in the same read.
  if (locale === undefined) throw new Error(`locationLanguageIn: no location ${locationId}`);
  return { locale, invoiceLocales: row!.invoiceLocales, area: row!.province };
}

async function offeredIn(
  tx: Transaction,
  location: { locale: string; area: string | null },
): Promise<[string, ...string[]]> {
  const { choices } = resolveInstalledReceiptLanguageRules({
    country: await countryIn(tx),
    area: location.area,
  });
  const { languages } = contentLanguagesOr(await readSavedContentLanguages(tx), location.locale);
  return offeredReceiptLanguages(location.locale, choices, languages);
}

/** {@link offeredReceiptLanguages} for a location, read in the caller's transaction: the location's
 * receipt language is always the first entry. With no saved content languages, only the location's
 * receipt language is offered. */
export async function readOfferedReceiptLanguages(
  tx: Transaction,
  params: { locationId: string },
): Promise<[string, ...string[]]> {
  return offeredIn(tx, await locationLanguageIn(tx, params.locationId));
}

/**
 * The `locale` and `invoiceLocales` a sale is filed with, given the receipt language saved on its
 * order (`stored`, undefined for none): the chosen language after the location's first, so the list's
 * first entry stays the location's first, a key the line descriptions are stored under and the one
 * the goods are read by (`namesLocale`). A saved language the location no longer offers files in
 * the location's receipt language and logs a warning: a sale is never refused for its language.
 */
export async function saleLanguageFor(
  tx: Transaction,
  locationId: string,
  stored: string | undefined,
  warn: { log: Logger | undefined; workingOrderId: string },
): Promise<{ locale: string; invoiceLocales: string[] }> {
  const location = await locationLanguageIn(tx, locationId);
  const filedIn = { locale: location.locale, invoiceLocales: location.invoiceLocales };
  if (stored === undefined || stored === location.locale) return filedIn;
  if (!(await offeredIn(tx, location)).includes(stored)) {
    warn.log?.("warn", "receipt_language.not_offered", {
      workingOrderId: warn.workingOrderId,
      language: stored,
      filedIn: location.locale,
    });
    return filedIn;
  }
  // `locations_invoice_locales_len` holds the location's list to one or two entries, so whenever
  // that list holds `stored` this pair IS that list.
  return { locale: stored, invoiceLocales: [location.locale, stored] };
}
