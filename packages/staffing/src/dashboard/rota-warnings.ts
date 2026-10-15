import { localTimeOccurrences, offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import type { Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import {
  validateRoster,
  type PlannedShift,
  type WorkTimeRuleset,
} from "@waitron/workforce/roster-validation";
import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { tf } from "./strings.js";
export function breachText(breach: RosterBreach): string {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(breach))
    values[key] =
      typeof value === "number" && key.endsWith("Minutes") ? String(value / 60) : String(value);
  return tf(`staffing.breach.${breach.kind}`, values);
}
export function shiftBreaches(breaches: readonly RosterBreach[], shiftId: string): RosterBreach[] {
  return breaches.filter((b) => "shiftId" in b && b.shiftId === shiftId);
}

export function candidateWarnings(
  week: RotaWeek,
  slot: Slot,
  personId: string,
  ruleset: WorkTimeRuleset | null,
): RosterBreach[] {
  if (!ruleset) return [];
  const cutover = week.days.find((d) => d.businessDay === slot.businessDay)!.cutover;
  const time = (at: string, end: boolean) => {
    const date =
      at < cutover || (end && at === cutover)
        ? new Date(Date.parse(`${slot.businessDay}T00:00:00Z`) + 86400000)
            .toISOString()
            .slice(0, 10)
        : slot.businessDay;
    return localTimeOccurrences(date, at, week.timeZone)[0];
  };
  const start = time(slot.startsAt, false),
    end = time(slot.endsAt, true);
  if (!start || !end) return [];
  const candidate: PlannedShift = {
    shiftId: "candidate",
    personId,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    startsOffsetMinutes: offsetMinutes(start.getTime(), week.timeZone),
    endsOffsetMinutes: offsetMinutes(end.getTime(), week.timeZone),
  };
  const baseline = new Set(validateRoster(week.shifts, ruleset).map((b) => JSON.stringify(b)));
  return validateRoster([...week.shifts, candidate], ruleset).filter(
    (b) => b.personId === personId && !baseline.has(JSON.stringify(b)),
  );
}
