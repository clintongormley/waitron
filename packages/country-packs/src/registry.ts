import type {
  CountryPack,
  FiscalModules,
  ReceiptLabels,
  ReceiptLanguageRules,
} from "@waitron/country";
import { contentLanguageRules, receiptLanguageRules, resolveCountryLocale } from "@waitron/country";
import { contentLanguageCode, type ContentLanguageRules } from "@waitron/shared";
import { SPAIN, SPAIN_RECEIPT_LABELS } from "@waitron/country-es";
import { UNITED_KINGDOM } from "@waitron/country-gb";

export type { FiscalModules } from "@waitron/country";

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

interface VenueGeography {
  readonly country?: string | null;
  readonly area?: string | null;
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

/** A receipt's fixed words in `locale`. A locale no installed pack labels (a stored `en-GB`, a bare
 * `es`) prints Spain's Spanish words, so a receipt never prints without them. */
export function receiptLabelsFor(locale: string): ReceiptLabels {
  for (const pack of COUNTRY_PACKS) {
    const labels = pack.receiptLabels?.[locale];
    if (labels !== undefined) return labels;
  }
  return FALLBACK_RECEIPT_LABELS;
}
