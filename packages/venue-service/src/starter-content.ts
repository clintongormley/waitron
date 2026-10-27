import type { StarterStaffLanguage, StarterTranslations } from "@waitron/country-packs";

/** A one-name row holds the staff language only, so these carry each staff language but English. */
type StaffNames = StarterTranslations<Exclude<StarterStaffLanguage, "en">>;

/** The starter service steps' names, keyed by their English names in `service-steps.ts`. */
export const STARTER_STEP_NAMES = {
  "Set up": { es: "Montar mesa" },
  "Take order": { es: "Tomar nota" },
  "Anything else?": { es: "¿Algo más?" },
} as const satisfies StaffNames;

/** The default seasons' names, keyed by their English names in `season-rules.ts`. */
export const STARTER_SEASON_NAMES = {
  Spring: { es: "Primavera" },
  Summer: { es: "Verano" },
  Autumn: { es: "Otoño" },
  Winter: { es: "Invierno" },
} as const satisfies StaffNames;

/** The starter counter zone's name, keyed by the English name in `provisioning.ts`. */
export const STARTER_ZONE_NAMES = {
  Counter: { es: "Mostrador" },
} as const satisfies StaffNames;

/** The starter menu period's name, keyed by the English name in `menu-timetable.ts`. */
export const STARTER_PERIOD_NAMES = {
  Open: { es: "Abierto" },
} as const satisfies StaffNames;
