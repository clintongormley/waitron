import { byStart, type Season } from "../season-rules.js";

const TINTS = 4;

/** Each season's tint, "1" to "4", by its place in start order, cycled past the fourth. */
export function seasonTints(
  seasons: readonly Pick<Season, "id" | "startsOn">[],
): Map<string, string> {
  return new Map(byStart(seasons).map((season, index) => [season.id, String((index % TINTS) + 1)]));
}
