import type { HolidayCoverage, SpecialDaysModel } from "../holiday-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

type Key = Parameters<typeof t>[0];

/** The national and regional sentence for a year's coverage, or the unknown one without it. */
export function nationalCoverage(year: number, coverage: HolidayCoverage | undefined): string {
  return format(`hours.calendar.coverage.${coverage?.nationalRegional ?? "unknown"}` as Key, {
    year: String(year),
  });
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
