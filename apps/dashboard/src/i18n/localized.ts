import { currentLocale } from "./t.js";

/**
 * Resolve a per-locale name map (e.g. a top seller's `descriptions`) to one display string: the entry
 * for the active locale, else the first value as a fallback, else "" for an empty map.
 *
 * This is the ONE place that rule lives — the business-overview screen (Task 7) and the daily-close
 * screen (Task 8) both call it rather than re-implementing the lookup inline. It strips the region
 * subtag before the lookup ("es-ES" → "es"), mirroring `pickLocale`'s region-strip rule (t.ts), because
 * a `descriptions` map is keyed by SHORT language subtags ("es" / "ca" / "en" — see the schema's
 * `invoiceLocales` and `computeTopSellers`), never by full BCP-47 tags. A map missing that language
 * degrades to whatever name it does carry so the operator never sees a blank cell.
 */
export function localizedName(map: Record<string, string>): string {
  const lang = currentLocale().replace(/-.*$/, ""); // "es-ES" → "es"
  return map[lang] ?? Object.values(map)[0] ?? "";
}
