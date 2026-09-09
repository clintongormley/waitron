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

const supportedJurisdictions = COUNTRY_PACKS.flatMap((pack) =>
  pack.fiscalJurisdictions.filter(
    (jurisdiction): jurisdiction is typeof jurisdiction & { modules: FiscalModules } =>
      jurisdiction.supported && jurisdiction.modules !== undefined,
  ),
);

export const FISCAL_TERRITORIES: readonly string[] = supportedJurisdictions.map(({ id }) => id);

export function findFiscalModules(territory: string): FiscalModules | undefined {
  return supportedJurisdictions.find(({ id }) => id === territory)?.modules;
}

export function resolveInstalledCountryLocale(
  availableLocales: readonly string[],
  input: {
    readonly override?: string | null;
    readonly area?: string | null;
    readonly country?: string | null;
    readonly fallback?: string;
  },
): string {
  const pack = input.country == null ? undefined : getCountryPack(input.country);
  if (pack === undefined) {
    return (
      [input.override, input.fallback, "en-GB"].find(
        (candidate): candidate is string =>
          candidate !== null && candidate !== undefined && availableLocales.includes(candidate),
      ) ??
      availableLocales[0] ??
      "en-GB"
    );
  }
  return resolveCountryLocale(pack, availableLocales, {
    override: input.override,
    area: input.area,
    fallback: input.fallback ?? "en-GB",
  });
}
