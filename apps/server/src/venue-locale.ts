// No `import "./errors.js"`: this file throws no AppError code.
import {
  readTenant,
  readVenue,
  withTransaction,
  type Database,
  type Transaction,
  type Venue,
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
): Promise<{ country: string | null; area: string | null }> {
  const country = await countryIn(tx);
  return { country, area: (await readVenue(tx)).province };
}

function readVenueGeography(
  db: Database,
): Promise<{ country: string | null; area: string | null }> {
  return withTransaction(db, geographyIn);
}

/**
 * The venue's default UI locale, from geography and an optional override, through the shared
 * `override → area → country → English` chain.
 *
 * This is a DISPLAY value, DELIBERATELY separate from the venue's receipt language. The
 * `override` is the RAW `WAITRON_TILL_LOCALE` (`cfg.localeOverride`), NOT the defaulted
 * `cfg.locale`, whose `es-ES` default would mask the geography derivation.
 */
export async function readVenueLocale(
  db: Database,
  params: { override?: string },
): Promise<SupportedLocale> {
  const { country, area } = await readVenueGeography(db);
  return resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
    override: params.override,
    area,
    country,
    fallback: FALLBACK_LOCALE,
  });
}

/** The content languages the venue's country pack keeps enabled for its area. */
export async function readVenueContentLanguageRules(db: Database): Promise<ContentLanguageRules> {
  return resolveInstalledContentLanguageRules(await readVenueGeography(db));
}

/** The receipt languages the venue's country pack offers, and the one its region fixes, if any,
 * read in the caller's transaction. `venue`, when given, is the venue row the caller already read
 * in it. */
export async function readVenueReceiptLanguageRules(
  tx: Transaction,
  venue?: Pick<Venue, "province">,
): Promise<ReceiptLanguageRules> {
  if (venue === undefined) return resolveInstalledReceiptLanguageRules(await geographyIn(tx));
  return resolveInstalledReceiptLanguageRules({
    country: await countryIn(tx),
    area: venue.province,
  });
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

async function venueLanguageIn(
  tx: Transaction,
): Promise<{ locale: string; invoiceLocales: string[]; area: string | null }> {
  const venue = await readVenue(tx);
  return {
    // `locations_invoice_locales_len` requires at least one language.
    locale: venue.invoiceLocales[0]!,
    invoiceLocales: venue.invoiceLocales,
    area: venue.province,
  };
}

async function offeredIn(
  tx: Transaction,
  venue: { locale: string; area: string | null },
): Promise<[string, ...string[]]> {
  const { choices } = resolveInstalledReceiptLanguageRules({
    country: await countryIn(tx),
    area: venue.area,
  });
  const { languages } = contentLanguagesOr(await readSavedContentLanguages(tx), venue.locale);
  return offeredReceiptLanguages(venue.locale, choices, languages);
}

/** {@link offeredReceiptLanguages} for a venue, read in the caller's transaction: the venue's
 * receipt language is always the first entry. With no saved content languages, only the venue's
 * receipt language is offered. */
export async function readOfferedReceiptLanguages(tx: Transaction): Promise<[string, ...string[]]> {
  return offeredIn(tx, await venueLanguageIn(tx));
}

/**
 * The `locale` and `invoiceLocales` a sale is filed with, given the receipt language saved on its
 * order (`stored`, undefined for none): the chosen language after the venue's first, so the list's
 * first entry stays the venue's first, a key the line descriptions are stored under and the one
 * the goods are read by (`namesLocale`). A saved language the venue no longer offers files in
 * the venue's receipt language and logs a warning: a sale is never refused for its language.
 */
export async function saleLanguageFor(
  tx: Transaction,
  stored: string | undefined,
  warn: { log: Logger | undefined; workingOrderId: string },
): Promise<{ locale: string; invoiceLocales: string[] }> {
  const venue = await venueLanguageIn(tx);
  const filedIn = { locale: venue.locale, invoiceLocales: venue.invoiceLocales };
  if (stored === undefined || stored === venue.locale) return filedIn;
  if (!(await offeredIn(tx, venue)).includes(stored)) {
    warn.log?.("warn", "receipt_language.not_offered", {
      workingOrderId: warn.workingOrderId,
      language: stored,
      filedIn: venue.locale,
    });
    return filedIn;
  }
  return { locale: stored, invoiceLocales: [venue.locale, stored] };
}
