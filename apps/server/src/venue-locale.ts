// No `import "./errors.js"`: this file throws no AppError code.
import { eq } from "drizzle-orm";
import {
  locations,
  readTenant,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  contentLanguagesOr,
  readReceiptLanguage,
  readSavedContentLanguages,
} from "@waitron/catalogue";
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

async function geographyIn(
  tx: Transaction,
  locationId: string,
): Promise<{ country: string | null; area: string | null }> {
  const t = await readTenant(tx);
  const [loc] = await tx
    .select({ province: locations.province })
    .from(locations)
    .where(eq(locations.id, locationId));
  return { country: t?.country ?? null, area: loc?.province ?? null };
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
): string[] {
  const offered = [receiptLanguage];
  for (const choice of packChoices) {
    if (!offered.includes(choice) && contentCodes.includes(contentLanguageCode(choice))) {
      offered.push(choice);
    }
  }
  return offered;
}

async function offeredFor(tx: Transaction, locationId: string, locale: string): Promise<string[]> {
  const { choices } = await readVenueReceiptLanguageRules(tx, { locationId });
  const { languages } = contentLanguagesOr(await readSavedContentLanguages(tx), locale);
  return offeredReceiptLanguages(locale, choices, languages);
}

/** {@link offeredReceiptLanguages} for a location, read in the caller's transaction. With no saved
 * content languages, only the location's receipt language is offered. */
export async function readOfferedReceiptLanguages(
  tx: Transaction,
  params: { locationId: string },
): Promise<string[]> {
  const { locale } = await readReceiptLanguage(tx, params.locationId);
  return offeredFor(tx, params.locationId, locale);
}

/**
 * The `locale` and `invoiceLocales` a sale is filed with, given the receipt language saved on its
 * order (`stored`, null for none): the chosen language after the location's first, so the list's
 * first entry stays the language its line descriptions were written in. A saved language the
 * location no longer offers files in the location's receipt language and logs a warning: a sale is
 * never refused for its language.
 */
export async function saleLanguageFor(
  tx: Transaction,
  locationId: string,
  stored: string | null,
  warn: { log: Logger | undefined; workingOrderId: string },
): Promise<{ locale: string; invoiceLocales: string[] }> {
  const location = await readReceiptLanguage(tx, locationId);
  if (stored === null || stored === location.locale) return location;
  if (!(await offeredFor(tx, locationId, location.locale)).includes(stored)) {
    warn.log?.("warn", "receipt_language.not_offered", {
      workingOrderId: warn.workingOrderId,
      language: stored,
      filedIn: location.locale,
    });
    return location;
  }
  // `locations_invoice_locales_len` holds the location's list to one or two entries, so whenever
  // that list holds `stored` this pair IS that list.
  return { locale: stored, invoiceLocales: [location.locale, stored] };
}

/** {@link saleLanguageFor} with the receipt language saved on working order `workingOrderId`. */
export async function readSaleLanguage(
  tx: Transaction,
  locationId: string,
  workingOrderId: string,
  log: Logger | undefined,
): Promise<{ locale: string; invoiceLocales: string[] }> {
  const [order] = await tx
    .select({ receiptLocale: workingOrders.receiptLocale })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  // Every caller has read or written the order in this transaction already.
  return saleLanguageFor(tx, locationId, order!.receiptLocale, { log, workingOrderId });
}
