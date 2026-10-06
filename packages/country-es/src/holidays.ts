import { createHolidayCalendar, type CountryHolidayCalendar } from "@waitron/country";
import { SPAIN_2026 } from "./data/es-2026.js";
import { HOLIDAY_AREAS, PROVINCE_REGIONS } from "./data/regions.js";
import { ANNEX_2026, GEOGRAPHY_SOURCES } from "./data/sources.js";

export const SPAIN_HOLIDAY_CALENDAR: CountryHolidayCalendar = createHolidayCalendar({
  // BOE-A-2025-21667: "hasta dos días de cada año natural con carácter de fiestas locales".
  localEntryLimit: 2,
  sources: [ANNEX_2026, ...GEOGRAPHY_SOURCES],
  provinceRegions: PROVINCE_REGIONS,
  areas: HOLIDAY_AREAS,
  years: [SPAIN_2026],
});
