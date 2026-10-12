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

const byStart = <T extends { startsOn: string }>(seasons: readonly T[]): T[] =>
  [...seasons].sort((a, b) => (a.startsOn < b.startsOn ? -1 : Number(a.startsOn > b.startsOn)));

/** The season holding `businessDay`: the latest start on or before its MM-DD, wrapping from the
 *  year's last season into the first. Null when there are no seasons. */
export function seasonOn<T extends { startsOn: string }>(
  seasons: readonly T[],
  businessDay: string,
): T | null {
  const sorted = byStart(seasons);
  const monthDay = businessDay.slice(5);
  const started = sorted.filter((season) => season.startsOn <= monthDay);
  return started.at(-1) ?? sorted.at(-1) ?? null;
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
