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

export function weekCounts(
  read: RotaWeek,
  show: Show,
): { unfilled: number; partly: number; over: number } {
  const matches = matchesFor(read, show);
  const slots = matches.flatMap((m) => m.slots);
  return {
    unfilled: slots.filter((s) => s.status.kind === "unfilled").length,
    partly: slots.filter((s) => s.status.kind === "partly_uncovered").length,
    over: matches.reduce((n, m) => n + m.over.length, 0),
  };
}

/** Shifts whose own business day is in the week; the read also carries the previous week's
 * shift that runs into Monday. */
export function weekShiftCount(read: RotaWeek): number {
  const days = new Set(read.days.map((d) => d.businessDay));
  return read.shifts.filter((s) => days.has(s.businessDay)).length;
}

export type Summary = "counts" | "all_filled" | "no_shifts" | "nothing_to_fill";

export function summary(read: RotaWeek, show: Show): Summary {
  const counts = weekCounts(read, show);
  if (counts.unfilled + counts.partly + counts.over > 0) return "counts";
  if (matchesFor(read, show).some((m) => m.slots.length > 0)) return "all_filled";
  if (show.kind === "everyone" && weekShiftCount(read) === 0) return "no_shifts";
  return "nothing_to_fill";
}
