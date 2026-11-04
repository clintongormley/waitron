// Browser-safe: no server imports.
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

export function holidayDisplayName(
  fact: { readonly name: string; readonly englishName?: string },
  language?: string,
): string {
  return language !== undefined && language.split("-")[0] !== "es"
    ? fact.englishName?.trim()
      ? fact.englishName
      : fact.name
    : fact.name;
}

/** The holiday labels on `date` joined with ` · `, each text once, or `original` when there are none. */
export function holidayDateName(
  facts: readonly HolidayFact[],
  date: LocalDate,
  original: string,
  language?: string,
): string {
  const labels = new Set(
    facts
      .filter((fact) => fact.date === date)
      .sort(compareHolidayFacts)
      .map((fact) => holidayDisplayName(fact, language)),
  );
  return labels.size === 0 ? original : [...labels].join(" · ");
}
