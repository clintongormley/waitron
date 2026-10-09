// Public-holiday types and constants only, safe to import in the browser.
import type { NamedDayKind } from "./named-day-rules.js";
import type { HolidayFact, LocalDate } from "./hours-types.js";

/** The longest local holiday name, in Unicode code points, after trimming. */
export const LOCAL_HOLIDAY_NAME_MAX = 200;

export interface HolidayCoverage {
  year: number;
  country: string;
  provinceCode: string | null;
  regionCode: string | null;
  nationalRegional:
    "complete" | "missing_year" | "unknown_region" | "area_required" | "unsupported_country";
  local: "address_unresolved" | "unsupported_country" | "none_entered" | "owner_entered";
  dataVersion: string | null;
  sourceIds: readonly string[];
}

export interface HolidaySource {
  id: string;
  kind: "official" | "owner";
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

export interface LocalHolidayInput {
  date: LocalDate;
  name: string;
}

export interface LocalHoliday extends LocalHolidayInput {
  id: string;
  geographyId: string;
}

export interface LocalHolidayModel {
  venue: { country: string; provinceCode: string | null; city: string | null };
  localEntryLimit: number;
  areaOptions: readonly { key: string; name: string }[];
  areaRequired: boolean;
  geographies: readonly HolidayGeography[];
  entries: readonly LocalHoliday[];
}

export interface NamedDay {
  id: string;
  date: LocalDate;
  name: string;
  kind: NamedDayKind;
  repeats: boolean;
  ownHours: boolean;
  closeWholeVenue: boolean;
  hasStationHours: boolean;
}
export interface NamedCalendarDay {
  date: LocalDate;
  namedDay: NamedDay | null;
  holidays: readonly HolidayFact[];
  tone: "public_holiday" | "own_holiday" | "working_day" | "closed" | "standard";
  ownHours: boolean;
  closed: boolean;
}
export interface NamedDaysModel {
  timeZone: string;
  dayCutover: string;
  civilDate: LocalDate | null;
  clockReadable: boolean;
  days: readonly NamedCalendarDay[];
  holidayCoverage: readonly HolidayCoverage[];
  holidaySources: readonly HolidaySource[];
  area: {
    options: readonly { key: string; name: string }[];
    required: boolean;
    chosen: string | null;
  };
  localHolidaysPerYear: number;
}
