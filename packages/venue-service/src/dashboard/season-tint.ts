import type { Season } from "../season-rules.js";

const TINTS = 4;

export const byStart = <T extends Pick<Season, "startsOn">>(seasons: readonly T[]): T[] =>
  [...seasons].sort((a, b) => (a.startsOn < b.startsOn ? -1 : Number(a.startsOn > b.startsOn)));

/** Each season's tint, "1" to "4", by its place in start order, cycled past the fourth. */
export function seasonTints(
  seasons: readonly Pick<Season, "id" | "startsOn">[],
): Map<string, string> {
  return new Map(byStart(seasons).map((season, index) => [season.id, String((index % TINTS) + 1)]));
}
