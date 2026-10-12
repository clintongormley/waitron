import type { BusinessDayScheduleStatus } from "./service-day-context.js";
// Public-holiday types and constants only, safe to import in the browser.
import type { CalendarDay, HolidayFact, LocalDate } from "./hours-types.js";

export interface HolidayCoverage {
  year: number;
  country: string;
  provinceCode: string | null;
  regionCode: string | null;
  nationalRegional:
    "complete" | "missing_year" | "unknown_region" | "area_required" | "unsupported_country";
  local: "address_unresolved" | "unsupported_country" | "none_entered";
  dataVersion: string | null;
  sourceIds: readonly string[];
}

export interface HolidaySource {
  id: string;
  kind: "official";
  title: string;
  url: string | null;
  sha256: string | null;
}

export interface HolidayRead {
  facts: readonly HolidayFact[];
  coverage: readonly HolidayCoverage[];
  sources: readonly HolidaySource[];
}

export interface HolidayGeography {
  id: string;
  country: string;
  provinceCode: string;
  city: string;
  areaKey: string | null;
  matchesVenue: boolean;
}

export interface HolidayAreaModel {
  readiness:
    "ready" | "missing_city" | "unresolved_province" | "unresolved_address" | "unsupported_country";
  venue: { country: string; provinceCode: string | null; city: string | null };
  localHolidaysPerYear: number;
  areaOptions: readonly { key: string; name: string }[];
  areaRequired: boolean;
  chosen: string | null;
}

export interface SpecialDaysModel extends BusinessDayScheduleStatus {
  timeZone: string;
  dayCutover: string;
  civilDate: LocalDate | null;
  clockReadable: boolean;
  days: readonly CalendarDay[];
  holidayCoverage: readonly HolidayCoverage[];
  holidaySources: readonly HolidaySource[];
  area: {
    readiness: HolidayAreaModel["readiness"];
    addressKey: string;
    options: readonly { key: string; name: string }[];
    required: boolean;
    chosen: string | null;
  };
  localHolidaysPerYear: number;
}
