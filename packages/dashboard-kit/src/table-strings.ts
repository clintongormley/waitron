import { currentLocale, pickLocale } from "./i18n.js";
import { TABLE_NO_MATCHES } from "./strings.js";

/** What every dashboard table says when its search or its filters hide every row. */
export function tableNoMatches(l: string = currentLocale()): string {
  return pickLocale(TABLE_NO_MATCHES, l);
}
