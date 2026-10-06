// Browser-safe rules for local holidays, shared by the writer, the editor and the import.
import { LOCAL_HOLIDAY_NAME_MAX } from "./holiday-types.js";

/** The trimmed name, or `null` when it is not a string, is blank, or passes the limit in code points. */
export function localHolidayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || [...trimmed].length > LOCAL_HOLIDAY_NAME_MAX ? null : trimmed;
}
