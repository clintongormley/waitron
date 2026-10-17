import { localTimeOccurrences } from "@waitron/venue-service/hours-occurrences";
import { areaKey, type AreaDayMatch, type AreaRef, type Slot } from "../slots.js";
import type { RotaWeek, StaffRole } from "../staffing-types.js";

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

/** The staff roles an area draws a row for: those with a slot, or a shift of the week's own days,
 *  in that area — in position order. */
export function rolesShown(read: RotaWeek, show: Show & { kind: "area" }): StaffRole[] {
  const days = new Set(read.days.map((d) => d.businessDay));
  const used = new Set([
    ...matchesFor(read, show).flatMap((m) => m.slots.map((s) => s.slot.staffRoleId)),
    ...read.shifts
      .filter((s) => s.area && areaKey(s.area) === show.key && days.has(s.businessDay))
      .map((s) => s.staffRoleId),
  ]);
  return read.staffRoles.filter((r) => used.has(r.id)).sort((a, b) => a.position - b.position);
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

/** Everyone's rows: by the lowest position among a person's staff roles, then name, then id; a
 *  person with no staff role after those with one. */
export function peopleInOrder(read: RotaWeek): RotaWeek["people"] {
  const position = new Map(read.staffRoles.map((r) => [r.id, r.position]));
  const lowest = (p: RotaWeek["people"][number]) =>
    Math.min(Infinity, ...p.staffRoleIds.map((id) => position.get(id) ?? Infinity));
  return [...read.people].sort(
    (a, b) =>
      lowest(a) - lowest(b) ||
      a.name.localeCompare(b.name) ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
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
  const people = peopleInOrder(read);
  const personRow = (shiftId: string) => {
    const personId = read.shifts.find((s) => s.shiftId === shiftId)?.personId;
    return people.findIndex((p) => p.personId === personId);
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

export function hasSlots(read: RotaWeek, show: Show): boolean {
  return matchesFor(read, show).some((m) => m.slots.length > 0);
}

export type PaintTarget =
  | { painter: "season"; id: string; name: string }
  | { painter: "special-day"; id: string; name: string };

/** What an unpainted area's paint button opens: the season of the first day (of the week, or the
 *  given day) that is not a special day, else the first special day's editor, else nothing. */
export function paintTarget(read: RotaWeek, day?: string): PaintTarget | null {
  const days = read.days.filter((d) => day === undefined || d.businessDay === day);
  for (const d of days) {
    const season = d.specialDay ? undefined : read.seasons.find((s) => s.id === d.seasonId);
    if (season) return { painter: "season", id: season.id, name: season.name };
  }
  const special = days.find((d) => d.specialDay)?.specialDay;
  return special ? { painter: "special-day", id: special.id, name: special.name } : null;
}

/** Shifts whose own business day is in the week; the read also carries the previous week's
 * shift that runs into Monday. */
export function weekShiftCount(read: RotaWeek): number {
  const days = new Set(read.days.map((d) => d.businessDay));
  return read.shifts.filter((s) => days.has(s.businessDay)).length;
}

export type Summary = "counts" | "all_filled" | "no_shifts" | "nothing_to_fill";

function summaryOf(show: Show, counts: Counts, slots: boolean, shiftCount: number): Summary {
  if (counts.unfilled + counts.partly + counts.over > 0) return "counts";
  if (slots) return "all_filled";
  if (show.kind === "everyone" && shiftCount === 0) return "no_shifts";
  return "nothing_to_fill";
}

export function summary(read: RotaWeek, show: Show): Summary {
  return summaryOf(show, weekCounts(read, show), hasSlots(read, show), weekShiftCount(read));
}

/** What the rota draws from one read in one Show, worked out once. */
export type RotaModel = {
  counts: Counts;
  summary: Summary;
  hasSlots: boolean;
  shiftCount: number;
  /** In an area, `rolesShown`; in Everyone, none. */
  roles: StaffRole[];
  days: ReadonlyMap<string, { counts: Counts; closed: boolean }>;
};

const models = new WeakMap<RotaWeek, Map<string, RotaModel>>();

/** The model of `read` in `show`, kept for as long as the read is: a read is never changed once
 *  drawn, each refresh is a new one. */
export function rotaModel(read: RotaWeek, show: Show): RotaModel {
  const key = show.kind === "area" ? show.key : EVERYONE;
  let byShow = models.get(read);
  if (!byShow) models.set(read, (byShow = new Map()));
  let model = byShow.get(key);
  if (!model) {
    const counts = weekCounts(read, show);
    const slots = hasSlots(read, show);
    const shiftCount = weekShiftCount(read);
    model = {
      counts,
      summary: summaryOf(show, counts, slots, shiftCount),
      hasSlots: slots,
      shiftCount,
      roles: show.kind === "area" ? rolesShown(read, show) : [],
      days: new Map(
        read.days.map(({ businessDay }) => [
          businessDay,
          {
            counts: dayCounts(read, show, businessDay),
            closed: isClosed(read, show, businessDay),
          },
        ]),
      ),
    };
    byShow.set(key, model);
  }
  return model;
}

export type OpenSlot = { slot: Slot; areaName: string };

/** A day's unfilled slots in every area, split by whether the person holds the slot's staff role. */
export function openSlots(
  read: RotaWeek,
  personId: string,
  businessDay: string,
): { own: OpenSlot[]; other: OpenSlot[] } {
  const held = read.people.find((p) => p.personId === personId)?.staffRoleIds ?? [];
  const open = (read.days.find((d) => d.businessDay === businessDay)?.areas ?? []).flatMap(
    ({ area, match }) =>
      match.slots
        .filter((s) => s.status.kind === "unfilled")
        .map((s) => ({
          slot: s.slot,
          areaName: read.areas.find((a) => areaKey(a.area) === areaKey(area))!.name,
        })),
  );
  return {
    own: open.filter((o) => held.includes(o.slot.staffRoleId)),
    other: open.filter((o) => !held.includes(o.slot.staffRoleId)),
  };
}

/** The instants a shift filling `slot` would start and end at, dated as the server dates them;
 *  null when the venue's clock never shows one of its times. */
export function slotInstants(read: RotaWeek, slot: Slot): { start: Date; end: Date } | null {
  const cutover = read.days.find((d) => d.businessDay === slot.businessDay)!.cutover;
  const at = (time: string, end: boolean) => {
    const date =
      time < cutover || (end && time === cutover)
        ? new Date(Date.parse(`${slot.businessDay}T00:00:00Z`) + 86400000)
            .toISOString()
            .slice(0, 10)
        : slot.businessDay;
    return localTimeOccurrences(date, time, read.timeZone)[0];
  };
  const start = at(slot.startsAt, false),
    end = at(slot.endsAt, true);
  return start && end ? { start, end } : null;
}

/** A slot's length in elapsed minutes, as a person's planned minutes count it; its clock length
 *  when the clock never shows one of its times, a slot the server refuses to fill. */
export function slotMinutes(read: RotaWeek, slot: Slot): number {
  const at = slotInstants(read, slot);
  return at ? (at.end.getTime() - at.start.getTime()) / 60000 : slot.end - slot.start;
}
