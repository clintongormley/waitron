// Browser-safe rules for local holidays, shared by the writer, the editor and the import.
import { LOCAL_HOLIDAY_NAME_MAX, type LocalHolidayModel } from "./holiday-types.js";

/** The trimmed name, or `null` when it is not a string, is blank, or passes the limit in code points. */
export function localHolidayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || [...trimmed].length > LOCAL_HOLIDAY_NAME_MAX ? null : trimmed;
}

/** Cities compare after NFC, trimmed with inner whitespace collapsed, and lowercased. */
export function holidayCityKey(city: string): string {
  return city.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * The geography a new local holiday is stored under, compared as the server compares it, or `null`
 * while the address does not resolve to one.
 */
export function holidayAddressKey(venue: LocalHolidayModel["venue"]): string | null {
  const { country, provinceCode, city } = venue;
  if (provinceCode === null || city === null) return null;
  return JSON.stringify([country, provinceCode, holidayCityKey(city)]);
}
