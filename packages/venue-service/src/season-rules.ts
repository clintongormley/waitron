export interface Season {
  id: string;
  name: string;
  startsOn: string; // MM-DD
}

export const DEFAULT_SEASONS: readonly { name: string; startsOn: string }[] = [
  { name: "Spring", startsOn: "03-01" },
  { name: "Summer", startsOn: "06-01" },
  { name: "Autumn", startsOn: "09-01" },
  { name: "Winter", startsOn: "12-01" },
];

const SEASON_START = /^(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** A season start as a common year's MM-DD, never 02-29 (`seasons_starts_on_ck`), or null. */
export function parseSeasonStart(value: unknown): string | null {
  if (typeof value !== "string" || !SEASON_START.test(value) || value === "02-29") return null;
  const date = new Date(`2001-${value}T00:00:00Z`);
  return date.getUTCDate() === Number(value.slice(3)) ? value : null;
}

const byStart = <T extends { startsOn: string }>(seasons: readonly T[]): T[] =>
  [...seasons].sort((a, b) => (a.startsOn < b.startsOn ? -1 : Number(a.startsOn > b.startsOn)));

/** The season holding `businessDay`: the latest start on or before its MM-DD, wrapping from the
 *  year's last season into the first. Null when there are no seasons. */
export function seasonOn<T extends { startsOn: string }>(
  seasons: readonly T[],
  businessDay: string,
): T | null {
  return seasonOnSorted(byStart(seasons), businessDay);
}

/** `seasonOn` over seasons already sorted by start. */
export function seasonOnSorted<T extends { startsOn: string }>(
  sorted: readonly T[],
  businessDay: string,
): T | null {
  const monthDay = businessDay.slice(5);
  let held: T | null = sorted.at(-1) ?? null;
  for (const season of sorted) if (season.startsOn <= monthDay) held = season;
  return held;
}

/** The MM-DD before the next season's start, for showing a season's range. */
export function seasonLastDay(seasons: readonly { startsOn: string }[], startsOn: string): string {
  const sorted = byStart(seasons);
  const next = (sorted.find((season) => season.startsOn > startsOn) ?? sorted[0])?.startsOn;
  const [month, day] = (next ?? startsOn).split("-").map(Number);
  // A common year, so the day before 03-01 is 02-28: a season never starts on 02-29.
  const before = new Date(Date.UTC(2001, month! - 1, day! - 1));
  const mm = String(before.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(before.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}
