import type { HolidayAreaModel, SpecialDaysModel } from "./holiday-types.js";
import { holidayCityKey } from "./holiday-rules.js";

export function holidayAreaSummary(area: HolidayAreaModel): SpecialDaysModel["area"] {
  return {
    readiness: area.readiness,
    addressKey: JSON.stringify([
      area.venue.country,
      area.venue.provinceCode,
      holidayCityKey(area.venue.city ?? ""),
    ]),
    options: area.areaOptions,
    required: area.areaRequired,
    chosen: area.chosen,
  };
}
