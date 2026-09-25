import { currentLocale } from "./t.js";

/** Building an `Intl.NumberFormat` is the expensive part, and an instance is safe to reuse. */
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Display only: never store the result or feed it back into arithmetic. `Number(value)` renders an
 * amount to the cent up to fifteen significant digits, and not reliably beyond; `decimalToCents`
 * (`@waitron/shared`) refuses an amount wider than `MAX_MONEY_INTEGER_DIGITS` integer digits when
 * it is converted for storage. es-ES output puts a no-break space (U+00A0, or U+202F on some ICU
 * builds) before the €, not an ASCII space.
 */
export function formatMoney(value: string, l: string = currentLocale()): string {
  let formatter = formatters.get(l);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(l, { style: "currency", currency: "EUR" });
    formatters.set(l, formatter);
  }
  return formatter.format(Number(value));
}
