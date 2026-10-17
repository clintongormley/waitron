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

type Counts = { unfilled: number; partly: number; over: number };
function countsOf(matches: AreaDayMatch[]): Counts {
  const slots = matches.flatMap((m) => m.slots);
  return {
    unfilled: slots.filter((s) => s.status.kind === "unfilled").length,
    partly: slots.filter((s) => s.status.kind === "partly_uncovered").length,
    over: matches.reduce((n, m) => n + m.over.length, 0),
  };
}

export function weekCounts(read: RotaWeek, show: Show): Counts {
  return countsOf(matchesFor(read, show));
}

export function dayCounts(read: RotaWeek, show: Show, businessDay: string): Counts {
  return countsOf(matchesFor(read, show, businessDay));
}

/** No active department opens that day and the scope has no slot on it. */
export function isClosed(read: RotaWeek, show: Show, businessDay: string): boolean {
  const day = read.days.find((d) => d.businessDay === businessDay);
  return (
    day?.hasHours === false &&
    matchesFor(read, show, businessDay).every((m) => m.slots.length === 0)
  );
}

export type Target = {
  businessDay: string;
  area?: AreaRef;
  slotKey?: string;
  shiftId?: string;
  header?: true;
};

/** What a count button steps through, in reading order: by day, then the grid's row, then start
 *  time. In Everyone an unfilled slot has no card, so unfilled steps through day headers. */
export function attentionTargets(
  read: RotaWeek,
  show: Show,
  kind: "unfilled" | "partly" | "over",
): Target[] {
  if (show.kind === "everyone" && kind === "unfilled")
    return read.days
      .filter((d) => dayCounts(read, show, d.businessDay).unfilled > 0)
      .map((d) => ({ businessDay: d.businessDay, header: true }));
  const rolePosition = (id: string | null) =>
    read.staffRoles.find((r) => r.id === id)?.position ?? Number.MAX_SAFE_INTEGER;
  const personRow = (shiftId: string) => {
    const personId = read.shifts.find((s) => s.shiftId === shiftId)?.personId;
    return read.people.findIndex((p) => p.personId === personId);
  };
  return read.days.flatMap((day) => {
    const found: { target: Target; row: number; start: number }[] = [];
    for (const { area, match } of day.areas) {
      if (show.kind === "area" && areaKey(area) !== show.key) continue;
      const at = { businessDay: day.businessDay, area };
      if (kind === "over")
        for (const shiftId of match.over) {
          const shift = read.shifts.find((s) => s.shiftId === shiftId)!;
          const row = show.kind === "area" ? rolePosition(shift.staffRoleId) : personRow(shiftId);
          found.push({ target: { ...at, shiftId }, row, start: shift.start });
        }
      else
        for (const { slot, status } of match.slots) {
          if (kind === "unfilled" && status.kind === "unfilled")
            found.push({
              target: { ...at, slotKey: slot.key },
              row: rolePosition(slot.staffRoleId),
              start: slot.start,
            });
          if (kind === "partly" && status.kind === "partly_uncovered")
            found.push({
              target: { ...at, slotKey: slot.key, shiftId: status.shiftId },
              row:
                show.kind === "area" ? rolePosition(slot.staffRoleId) : personRow(status.shiftId),
              start: slot.start,
            });
        }
    }
    return found.sort((a, b) => a.row - b.row || a.start - b.start).map((f) => f.target);
  });
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
