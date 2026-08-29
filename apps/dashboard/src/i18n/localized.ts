import { currentLocale } from "./t.js";

/**
 * Resolve a per-locale name map (e.g. a top seller's `descriptions`) to one display string: the entry
 * for the active locale, else the first value as a fallback, else "" for an empty map.
 *
 * This is the ONE place that rule lives — the business-overview screen (Task 7) and the daily-close
 * screen (Task 8) both call it rather than re-implementing the lookup inline. It keys on the full
 * locale tag (`currentLocale()`, e.g. "es-ES"), matching how the server keys `descriptions`; a map
 * missing that key degrades to whatever name it does carry so the operator never sees a blank cell.
 */
export function localizedName(map: Record<string, string>): string {
  return map[currentLocale()] ?? Object.values(map)[0] ?? "";
}
