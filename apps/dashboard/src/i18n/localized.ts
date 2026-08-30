import { currentLocale } from "./t.js";

/**
 * Resolve a per-locale name map (e.g. a top seller's `descriptions`) to one display string: the entry
 * for the active locale, else the first value as a fallback, else "" for an empty map.
 *
 * This is the ONE place that rule lives — the business-overview screen (Task 7) and the daily-close
 * screen (Task 8) both call it rather than re-implementing the lookup inline.
 *
 * A `descriptions` map is keyed INCONSISTENTLY across the tree, so this tries both forms in order:
 * FULL invoice-locale tag first ("es-ES"), then the SHORT language subtag ("es"), then any value.
 * Both keyings are live and neither is "never" used: the receipt/invoice path keys by the full tag
 * (`apps/server/src/receipt-ticket.ts`'s `lineName` looks up `descriptions[invoiceLocale]`, e.g.
 * "es-ES", and the `/reports/overview` seed writes `{ "es-ES": … }`), while the catalogue/product path
 * keys by the short subtag (`apps/dashboard/src/widgets/product-list.ts` looks up
 * `descriptions[primaryLocale]`, e.g. "es"). Trying full-then-short handles both without either shape
 * falling through: a full-tag map hits on the first arm, a short-subtag map on the second. (This is NOT
 * `pickLocale` — that resolves the fixed {en,es} UI catalogue, a different data source with its own
 * English-degrade rule.) A map carrying neither key degrades to whatever name it does hold so the
 * operator never sees a blank cell.
 */
export function localizedName(map: Record<string, string>): string {
  const loc = currentLocale(); // e.g. "es-ES"
  const lang = loc.replace(/-.*$/, ""); // e.g. "es"
  return map[loc] ?? map[lang] ?? Object.values(map)[0] ?? "";
}
