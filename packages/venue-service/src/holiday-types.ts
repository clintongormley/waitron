// Public-holiday types and constants only, safe to import in the browser.
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
