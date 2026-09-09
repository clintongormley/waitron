import type { CountryPack, FiscalModules } from "@waitron/country";
import { resolveCountryLocale } from "@waitron/country";
import { SPAIN } from "@waitron/country-es";
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

/** `filing` selects the filing adapter; `tax` selects tax rules. `none` is an unimplemented slot. */
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
