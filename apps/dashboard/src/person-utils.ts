import type { PersonSummary } from "./api/staff-api.js";

export function personNameMap(staff: PersonSummary[]): Map<string, string> {
  return new Map(staff.map((p) => [p.personId, p.displayName]));
}

export function resolvePersonName(names: Map<string, string>, personId: string): string {
  return names.get(personId) ?? personId;
}
