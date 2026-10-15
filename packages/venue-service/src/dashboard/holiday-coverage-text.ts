import type { HolidayCoverage, SpecialDaysModel } from "../holiday-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

/** A year's national and regional state that has a sentence of its own: a complete list has none,
 *  and the Year asks for a missing holiday area in words of its own. */
export type CoverageWarning =
  Exclude<HolidayCoverage["nationalRegional"], "complete" | "area_required"> | "unknown";

/** The national and regional sentence for a year's coverage. */
export function nationalCoverage(year: number, state: CoverageWarning): string {
  return format(`hours.calendar.coverage.${state}` as const, { year: String(year) });
}

/** Why the holiday area cannot be chosen yet; empty once the address is ready. */
export function areaAddress(readiness: SpecialDaysModel["area"]["readiness"]): string {
  switch (readiness) {
    case "missing_city":
      return t("holidays.area_needs_city");
    case "unresolved_province":
      return t("holidays.area_needs_province");
    case "unresolved_address":
      return t("holidays.area_needs_address");
    case "unsupported_country":
      return t("holidays.area_unsupported");
    case "ready":
      return "";
  }
}
