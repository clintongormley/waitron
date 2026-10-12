import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { seasonLastDay } from "../season-rules.js";
import { formatMonthDay } from "./hours-view.js";

type Seasons = OpeningHoursModel["seasons"];

/** The season the address names when the venue has it, else the current season, else the first. */
export function chosenSeasonId(
  seasons: Seasons,
  currentSeasonId: string | null,
  requested: string,
): string {
  if (seasons.some((season) => season.id === requested)) return requested;
  return currentSeasonId ?? seasons[0]?.id ?? "";
}

export function seasonOptions(seasons: Seasons) {
  return seasons.map((season) => ({
    value: season.id,
    label: `${season.name} · ${formatMonthDay(season.startsOn)} – ${formatMonthDay(seasonLastDay(seasons, season.startsOn))}`,
  }));
}

export function seasonWeek<Day>(
  seasonWeeks: readonly { seasonId: string; week: readonly Day[] }[],
  seasonId: string,
): readonly Day[] {
  return seasonWeeks.find((entry) => entry.seasonId === seasonId)?.week ?? [];
}
