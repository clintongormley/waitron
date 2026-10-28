import { findAdministrativeArea, type CountryDemoIdentity, type CountryPack } from "./country.js";

export function resolveCountryDemoIdentity(
  pack: CountryPack,
  areaValue?: string | null,
): CountryDemoIdentity | undefined {
  if (pack.demo === undefined) return undefined;
  const regional = areaValue == null ? undefined : findAdministrativeArea(pack, areaValue)?.demo;
  return { ...pack.demo, ...regional };
}
