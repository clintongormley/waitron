/**
 * Re-key bare-language catalogue content to a location's full-tag `invoice_locales` at the fiscal
 * line (feature B). Venues author product/menu text under the BARE language tag (`es` = "our
 * Spanish"); the `working_order_lines_check_locales` trigger requires the per-line `descriptions`
 * map be keyed EXACTLY by the location's full tags (`es-ES`). This transform bridges the two.
 *
 * §5 "nothing may block a sale": this runs on the sale path, so it NEVER throws. A tag with no
 * matching catalogue text graceful-fills from any available catalogue entry, and an empty catalogue
 * yields the empty string rather than an error.
 */

/** Bare language of a BCP-47 tag: everything before the first `-` (`es-ES` → `es`, `es` → `es`). */
function bareLanguage(tag: string): string {
  return tag.replace(/-.*$/, "");
}

/**
 * Produce a descriptions map keyed by EXACTLY `invoiceLocales` (full BCP-47 tags), from bare-language
 * catalogue content. For each full tag, region-strip to its language and use the catalogue's text for
 * that language; if absent, fall back to any catalogue entry — NEVER throw.
 *
 * Resolution per full tag `t` (`lang = bareLanguage(t)`):
 *   `catalogue[t] ?? catalogue[lang] ?? catalogue[<first key whose bareLanguage === lang>]
 *     ?? Object.values(catalogue)[0] ?? ""`.
 */
export function toInvoiceLineDescriptions(
  catalogue: Record<string, string>,
  invoiceLocales: string[],
): Record<string, string> {
  const primary = Object.values(catalogue)[0] ?? "";
  const result: Record<string, string> = {};

  for (const tag of invoiceLocales) {
    const lang = bareLanguage(tag);
    // The full-tag and bare-language direct lookups are the common path; only when BOTH miss do we scan
    // the keys for another region of the same language (the graceful-fill path), so the `.find()` runs
    // just there rather than on every iteration.
    let text = catalogue[tag] ?? catalogue[lang];
    if (text === undefined) {
      const byLanguageKey = Object.keys(catalogue).find((key) => bareLanguage(key) === lang);
      if (byLanguageKey !== undefined) text = catalogue[byLanguageKey];
    }
    result[tag] = text ?? primary;
  }

  return result;
}
