// Browser-safe: the editor's Make-special draft and the server's duplicate both name dates here.
import type { HolidayFact, LocalDate } from "./hours-types.js";

const SCOPE_ORDER: Readonly<Record<HolidayFact["scope"], number>> = {
  national: 0,
  regional: 1,
  local: 2,
};

/** By date, then national, regional, local, then fact id. */
export function compareHolidayFacts(a: HolidayFact, b: HolidayFact): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.scope !== b.scope) return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
  return a.id < b.id ? -1 : 1;
}

/** The holiday labels on `date` joined with ` · `, each text once, or `original` when there are none. */
export function holidayDateName(
  facts: readonly HolidayFact[],
  date: LocalDate,
  original: string,
): string {
  const labels = new Set(
    facts
      .filter((fact) => fact.date === date)
      .sort(compareHolidayFacts)
      .map(({ name }) => name),
  );
  return labels.size === 0 ? original : [...labels].join(" · ");
}
