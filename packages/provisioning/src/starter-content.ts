import type { StarterStaffLanguage, StarterTranslations } from "@waitron/country-packs";

/** A one-name row holds the staff language only, so these carry each staff language but English. */
type StaffNames = StarterTranslations<Exclude<StarterStaffLanguage, "en">>;

/** The starter kitchen station's name, keyed by the English name `venue-plan.ts` gives it. */
export const STARTER_STATION_NAMES = {
  Kitchen: { es: "Cocina" },
} as const satisfies StaffNames;

/** The starter device profiles' names, keyed by their English names in `@waitron/layouts`. */
export const STARTER_PROFILE_NAMES = {
  Counter: { es: "Mostrador" },
  Kitchen: { es: "Cocina" },
  Handheld: { es: "Móvil" },
} as const satisfies StaffNames;
