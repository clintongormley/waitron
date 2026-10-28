import { normalizeRecipientCountryCode } from "./recipient-countries.js";
import type {
  CountryPack,
  FiscalModules,
  ReceiptLabels,
  ReceiptLanguageRules,
  RecipientIdentifierResult,
} from "@waitron/country";
import {
  contentLanguageRules,
  receiptLanguageRules,
  resolveCountryLocale,
  resolveCountryDemoIdentity,
  validateRecipientIdentifier,
} from "@waitron/country";
import { contentLanguageCode, FALLBACK_LOCALE, type ContentLanguageRules } from "@waitron/shared";
import {
  SPAIN,
  SPAIN_RECEIPT_LABELS,
  SPAIN_RECIPIENT_REGION_NAMES,
  SPAIN_RECIPIENT_IDENTIFIER_POLICY,
} from "@waitron/country-es";
import { UNITED_KINGDOM } from "@waitron/country-gb";

export type { FiscalModules } from "@waitron/country";
export type {
  RecipientIdentifier,
  RecipientIdentifierType,
  RecipientIdentifierResult,
} from "@waitron/country";
export { SPAIN_RECIPIENT_REGION_NAMES as RECIPIENT_REGION_NAMES };

export function recipientIdentifierResult(input: unknown): RecipientIdentifierResult {
  return validateRecipientIdentifier(input, SPAIN_RECIPIENT_IDENTIFIER_POLICY);
}

/** The sole registry of country implementations installed in this build. */
export const COUNTRY_PACKS: readonly CountryPack[] = [SPAIN, UNITED_KINGDOM];

export function getCountryPack(countryCode: string): CountryPack | undefined {
  const normalized = countryCode.trim().toUpperCase();
  return COUNTRY_PACKS.find((pack) => pack.countryCode === normalized);
}

/** Packs whose fiscal selection and validators are complete enough for interactive venue creation. */
export const VENUE_SETUP_COUNTRY_PACKS: readonly CountryPack[] = COUNTRY_PACKS.filter(
  ({ availableForVenueSetup }) => availableForVenueSetup,
);

export function getVenueSetupCountryPack(countryCode: string): CountryPack | undefined {
  const normalized = countryCode.trim().toUpperCase();
  return VENUE_SETUP_COUNTRY_PACKS.find((pack) => pack.countryCode === normalized);
}

const supportedJurisdictions = COUNTRY_PACKS.flatMap((pack) =>
  pack.fiscalJurisdictions.flatMap(({ id, supported, modules }) =>
    supported && modules !== undefined
      ? [{ id, modules: Object.freeze({ filing: modules.filing, tax: modules.tax }) }]
      : [],
  ),
);

export const FISCAL_TERRITORIES: readonly string[] = supportedJurisdictions.map(({ id }) => id);

export function findFiscalModules(territory: string): FiscalModules | undefined {
  return supportedJurisdictions.find(({ id }) => id === territory)?.modules;
}

export function resolveInstalledCountryLocale<Locale extends string>(
  availableLocales: readonly Locale[],
  input: {
    readonly override?: string | null;
    readonly area?: string | null;
    readonly country?: string | null;
    readonly fallback: Locale;
  },
): Locale {
  const pack = input.country == null ? undefined : getCountryPack(input.country);
  if (pack === undefined) {
    return (
      [input.override, input.fallback].find(
        (candidate): candidate is Locale =>
          candidate !== null &&
          candidate !== undefined &&
          (availableLocales as readonly string[]).includes(candidate),
      ) ??
      availableLocales[0] ??
      input.fallback
    );
  }
  return resolveCountryLocale(pack, availableLocales, {
    override: input.override,
    area: input.area,
    fallback: input.fallback,
  });
}

export interface VenueGeography {
  readonly country?: string | null;
  readonly area?: string | null;
}

export function resolveInstalledDemoIdentity(input: VenueGeography) {
  const pack = packFor(input);
  return pack === undefined ? undefined : resolveCountryDemoIdentity(pack, input.area);
}

function packFor(input: VenueGeography): CountryPack | undefined {
  return input.country == null ? undefined : getCountryPack(input.country);
}

function codes(locales: readonly string[]): string[] {
  return [...new Set(locales.map(contentLanguageCode))];
}

/** The venue's content-language rules from its installed country pack, as language codes. */
export function resolveInstalledContentLanguageRules(input: VenueGeography): ContentLanguageRules {
  const pack = packFor(input);
  if (pack === undefined) return { required: [], official: [] };
  const rules = contentLanguageRules(pack, input.area);
  return {
    required: codes(rules.required),
    official: codes(rules.official),
    ...(rules.foreignLanguageNotice === undefined
      ? {}
      : { foreignLanguageNotice: rules.foreignLanguageNotice }),
  };
}

/** A NEW venue's default content language where its area names one, as a language code. */
export function resolveInstalledDefaultContentLanguage(input: VenueGeography): string | undefined {
  const pack = packFor(input);
  const locale =
    pack === undefined ? undefined : contentLanguageRules(pack, input.area).defaultContentLocale;
  return locale === undefined ? undefined : contentLanguageCode(locale);
}

export interface StartingContentLanguages {
  readonly defaultLanguage: string;
  /** The default first, then the area's required languages, then English. */
  readonly languages: readonly string[];
  readonly required: readonly string[];
}

/** Switched on for every new venue, required nowhere (owner, 2026-10-06;
 * docs/developers/products.md → "Content languages per region"). */
const ENGLISH = "en";

/** The content languages a NEW venue starts with in this area, as language codes. */
export function resolveInstalledStartingContentLanguages(
  input: VenueGeography,
): StartingContentLanguages {
  const pack = packFor(input);
  const rules = pack === undefined ? undefined : contentLanguageRules(pack, input.area);
  const required = rules === undefined ? [] : codes(rules.required);
  const defaultLanguage = contentLanguageCode(
    rules?.defaultContentLocale ?? pack?.defaultLocale ?? FALLBACK_LOCALE,
  );
  return {
    defaultLanguage,
    languages: [...new Set([defaultLanguage, ...required, ENGLISH])],
    required,
  };
}

/** What a receipt prints in when the venue's country has no installed pack, and how a receipt in a
 * language the browser cannot format writes its amounts and dates: `loadTillConfig`'s default when
 * `WAITRON_TILL_LOCALE` is unset. */
export const FALLBACK_RECEIPT_LOCALE = SPAIN.defaultLocale;
const FALLBACK_RECEIPT_LABELS: ReceiptLabels =
  SPAIN_RECEIPT_LABELS[SPAIN.defaultLocale as keyof typeof SPAIN_RECEIPT_LABELS];

/** The receipt languages the venue's installed country pack offers, and the one it fixes, if any. */
export function resolveInstalledReceiptLanguageRules(input: VenueGeography): ReceiptLanguageRules {
  const pack = packFor(input);
  if (pack === undefined) return { choices: [], defaultLocale: FALLBACK_RECEIPT_LOCALE };
  return receiptLanguageRules(pack, input.area);
}

/** Exact resource lookup; unlabelled locales use Spain's Spanish words. */
export function receiptLabelsFor(locale: string): ReceiptLabels {
  for (const pack of COUNTRY_PACKS) {
    const labels = pack.receiptLabels?.[locale];
    if (labels !== undefined) return labels;
  }
  return FALLBACK_RECEIPT_LABELS;
}

function regionNameFor(code: string, locale: string): string | undefined {
  try {
    const language = new Intl.Locale(locale).language;
    const stored = SPAIN_RECIPIENT_REGION_NAMES[language]?.[code];
    return stored ?? new Intl.DisplayNames([locale], { type: "region", fallback: "none" }).of(code);
  } catch {
    return undefined;
  }
}

export function countryNameFor(countryCode: string, locale: string): string {
  const code = normalizeRecipientCountryCode(countryCode);
  if (code === undefined) return countryCode;
  const pack = getCountryPack(code);
  return (
    pack?.countryNames?.[locale] ??
    regionNameFor(code, locale) ??
    pack?.countryNames?.["en-GB"] ??
    regionNameFor(code, "en-GB") ??
    code
  );
}

export function receiptCountryNameFor(countryCode: string, locale: string): string {
  const receiptLocale = COUNTRY_PACKS.some((pack) => pack.receiptLabels?.[locale] !== undefined)
    ? locale
    : FALLBACK_RECEIPT_LOCALE;
  return countryNameFor(countryCode, receiptLocale);
}
