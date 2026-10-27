import { starterName, type StarterStaffLanguage } from "@waitron/country-packs";
import { DEFAULT_SEASONS } from "../season-rules.js";
import { STARTER_SEASON_NAMES } from "../starter-content.js";

/** The stored name of the default season called `english`, in a venue with this staff language. */
export function starterSeasonName(english: string, staffLanguage: StarterStaffLanguage): string {
  return starterName(STARTER_SEASON_NAMES, english, staffLanguage);
}

/** The English handle of a stored season name; a season not in the starter file keeps its name.
 *  Outside English, a stored English default name throws, so a writer falling back to English
 *  fails every suite that reads seasons through here. */
export function englishSeasonName(stored: string, staffLanguage: StarterStaffLanguage): string {
  if (staffLanguage === "en") return stored;
  if (DEFAULT_SEASONS.some((season) => season.name === stored))
    throw new Error(`season "${stored}" is stored in English in a ${staffLanguage} venue`);
  const english = DEFAULT_SEASONS.find(
    (season) => starterSeasonName(season.name, staffLanguage) === stored,
  );
  return english?.name ?? stored;
}
