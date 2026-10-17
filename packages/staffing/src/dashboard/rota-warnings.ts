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

/** The week's warnings before any candidate, which `candidateWarnings` leaves out. */
export function rosterBaseline(week: RotaWeek, ruleset: WorkTimeRuleset): ReadonlySet<string> {
  return new Set(validateRoster(week.shifts, ruleset).map((b) => JSON.stringify(b)));
}

/** What filling `slot` with the person would add to their warnings; `baseline` is
 *  `rosterBaseline` of the same week and ruleset, worked out here when not given. */
export function candidateWarnings(
  week: RotaWeek,
  slot: Slot,
  personId: string,
  ruleset: WorkTimeRuleset | null,
  baseline?: ReadonlySet<string>,
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
  const before = baseline ?? rosterBaseline(week, ruleset);
  return validateRoster([...week.shifts, candidate], ruleset).filter(
    (b) => b.personId === personId && !before.has(JSON.stringify(b)),
  );
}
