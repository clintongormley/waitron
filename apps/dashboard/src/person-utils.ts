import type { PersonSummary } from "./api/client.js";

/**
 * Person-name resolution for the dashboard screens that render person ids as display names
 * (approvals, planned-vs-actual). Both loaded the staff list and did a per-row `staff.find(...)`,
 * which is O(rows × staff); building the lookup once when the staff list loads makes each render-row
 * resolution O(1).
 */

/** A `personId → displayName` lookup built once from the loaded staff list. */
export function personNameMap(staff: PersonSummary[]): Map<string, string> {
  return new Map(staff.map((p) => [p.personId, p.displayName]));
}

/** A person's display name from a prebuilt map, or the raw id when it is not in the map (a row that
 * references someone off the staff list). */
export function resolvePersonName(names: Map<string, string>, personId: string): string {
  return names.get(personId) ?? personId;
}
