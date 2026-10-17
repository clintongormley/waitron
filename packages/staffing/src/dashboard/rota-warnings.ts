import { offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import type { Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import { slotInstants } from "./rota-model.js";
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
  const at = slotInstants(week, slot);
  if (!at) return [];
  const { start, end } = at;
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
