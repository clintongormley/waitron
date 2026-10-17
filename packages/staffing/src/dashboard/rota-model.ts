import { areaKey, type AreaDayMatch, type AreaRef } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";

export const EVERYONE = "everyone";
export type Show =
  { kind: "everyone" } | { kind: "area"; area: AreaRef; key: string; name: string };

export function chosenShow(read: RotaWeek, asked: string | undefined): Show {
  if (asked === EVERYONE || read.areas.length === 0) return { kind: "everyone" };
  const found = read.areas.find((a) => areaKey(a.area) === asked) ?? read.areas[0]!;
  return { kind: "area", area: found.area, key: areaKey(found.area), name: found.name };
}

export function matchesFor(read: RotaWeek, show: Show, businessDay?: string): AreaDayMatch[] {
  return read.days
    .filter((d) => businessDay === undefined || d.businessDay === businessDay)
    .flatMap((d) =>
      d.areas
        .filter((a) => show.kind === "everyone" || areaKey(a.area) === show.key)
        .map((a) => a.match),
    );
}
