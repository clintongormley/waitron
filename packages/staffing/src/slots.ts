export type AreaKind = "department" | "station";
export interface AreaRef {
  kind: AreaKind;
  id: string;
}
export interface StaffingBlock {
  staffRoleId: string;
  headcount: number;
  startsAt: string;
  endsAt: string;
}
export interface Slot {
  key: string;
  businessDay: string;
  area: AreaRef;
  staffRoleId: string;
  startsAt: string;
  endsAt: string;
  /** Minutes from the business day's changeover. */
  start: number;
  end: number;
}
export interface RotaShift {
  shiftId: string;
  personId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  area: AreaRef | null;
  staffRoleId: string | null;
}
export interface PlacedShift extends RotaShift {
  businessDay: string;
  start: number;
  end: number;
}
export type SlotStatus =
  | { kind: "filled"; shiftId: string; outsideRole: boolean }
  | {
      kind: "partly_uncovered";
      shiftId: string;
      outsideRole: boolean;
      uncovered: { start: number; end: number }[];
    }
  | { kind: "unfilled" };
export interface AreaDayMatch {
  slots: { slot: Slot; status: SlotStatus }[];
  over: string[];
}

const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function minuteOfServiceDay(time: string, cutover: string): number {
  return (clockMinutes(time) - clockMinutes(cutover) + 1440) % 1440;
}

export function blockSpan(
  block: Pick<StaffingBlock, "startsAt" | "endsAt">,
  cutover: string,
): { start: number; end: number } {
  return {
    start: minuteOfServiceDay(block.startsAt, cutover),
    end: minuteOfServiceDay(block.endsAt, cutover) || 1440,
  };
}

export const areaKey = (area: AreaRef): string => `${area.kind}:${area.id}`;

export function slotsForDay(
  businessDay: string,
  area: AreaRef,
  blocks: readonly StaffingBlock[],
  cutover: string,
): Slot[] {
  const slots: Slot[] = [];
  blocks.forEach((b, blockIndex) => {
    const span = blockSpan(b, cutover);
    // A block saved before a changeover change can cross the new changeover; it ends there.
    const { start, end } = span.end > span.start ? span : { start: span.start, end: 1440 };
    for (let n = 0; n < b.headcount; n += 1) {
      slots.push({
        key: `${businessDay}|${areaKey(area)}|${blockIndex}|${n}`,
        businessDay,
        area,
        staffRoleId: b.staffRoleId,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        start,
        end,
      });
    }
  });
  return slots.sort(
    (a, b) =>
      a.start - b.start || a.staffRoleId.localeCompare(b.staffRoleId) || a.key.localeCompare(b.key),
  );
}

const wallMs = (instant: string, offsetMinutes: number) =>
  Date.parse(instant) + offsetMinutes * 60_000;

function wall(instant: string, offsetMinutes: number): { date: string; time: string } {
  const iso = new Date(wallMs(instant, offsetMinutes)).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function placeShift(
  shift: RotaShift,
  cutoverFor: (businessDay: string) => string,
): PlacedShift {
  const { date, time } = wall(shift.startsAt, shift.startsOffsetMinutes);
  const businessDay =
    clockMinutes(time) < clockMinutes(cutoverFor(date)) ? previousDay(date) : date;
  // Not modulo 1440: when the changeover moves later overnight, the business day runs past
  // 24 hours, and a shift after its own day's changeover hour on the next date belongs past 1440.
  const dayGap = date === businessDay ? 0 : 1440;
  const start = dayGap + clockMinutes(time) - clockMinutes(cutoverFor(businessDay));
  // Wall-clock length, not elapsed time: slots are wall-clock, and on a clock-change night a
  // 22:00–04:00 shift lasts five or seven elapsed hours but still ends at 04:00 on the wall.
  const minutes =
    (wallMs(shift.endsAt, shift.endsOffsetMinutes) -
      wallMs(shift.startsAt, shift.startsOffsetMinutes)) /
    60_000;
  return { ...shift, businessDay, start, end: start + minutes };
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function matchAreaDay(
  slots: readonly Slot[],
  shifts: readonly PlacedShift[],
  holds: (personId: string, staffRoleId: string) => boolean,
): AreaDayMatch {
  const pairs: { slot: Slot; shift: PlacedShift; size: number }[] = [];
  for (const slot of slots) {
    for (const shift of shifts) {
      if (shift.staffRoleId !== slot.staffRoleId) continue;
      const size = overlap(slot, shift);
      if (size > 0) pairs.push({ slot, shift, size });
    }
  }
  pairs.sort(
    (a, b) =>
      b.size - a.size ||
      a.slot.start - b.slot.start ||
      a.shift.start - b.shift.start ||
      a.slot.key.localeCompare(b.slot.key) ||
      a.shift.shiftId.localeCompare(b.shift.shiftId),
  );
  const bySlot = new Map<string, PlacedShift>();
  const used = new Set<string>();
  for (const { slot, shift } of pairs) {
    if (bySlot.has(slot.key) || used.has(shift.shiftId)) continue;
    bySlot.set(slot.key, shift);
    used.add(shift.shiftId);
  }
  return {
    slots: slots.map((slot): { slot: Slot; status: SlotStatus } => {
      const shift = bySlot.get(slot.key);
      if (shift === undefined) return { slot, status: { kind: "unfilled" } };
      const outsideRole = !holds(shift.personId, slot.staffRoleId);
      const uncovered = [
        ...(shift.start > slot.start
          ? [{ start: slot.start, end: Math.min(shift.start, slot.end) }]
          : []),
        ...(shift.end < slot.end
          ? [{ start: Math.max(shift.end, slot.start), end: slot.end }]
          : []),
      ];
      return uncovered.length === 0
        ? { slot, status: { kind: "filled", shiftId: shift.shiftId, outsideRole } }
        : {
            slot,
            status: { kind: "partly_uncovered", shiftId: shift.shiftId, outsideRole, uncovered },
          };
    }),
    over: shifts
      .filter((s) => !used.has(s.shiftId))
      .map((s) => s.shiftId)
      .sort(),
  };
}
