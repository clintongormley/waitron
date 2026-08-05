/**
 * Format a money amount for display.
 *
 * `value` is a `Decimal` string — money is stored and carried as an exact
 * decimal string (spec §9 forbids storing formatted or floating-point money),
 * and this is the EDGE where that string becomes human-readable text. The
 * returned string is for display only; never store it and never feed it back
 * into arithmetic.
 *
 * `Number(value)` is safe here and only here: at money scale the value is at
 * most ~12 integer digits and 2 decimal places, well within IEEE-754 double
 * precision, so the display conversion is lossless. It must NOT be used to round
 * or compute — that stays in `Decimal` upstream; this call is the last step
 * before the pixels.
 *
 * The default locale is es-ES (the deli renders Spanish). Note that
 * `Intl.NumberFormat("es-ES", …)` places a non-breaking space (U+00A0, or a
 * narrow no-break space U+202F on some ICU builds) between the amount and the €,
 * not an ASCII space — callers comparing the output must account for that.
 */

/**
 * Cache the `Intl.NumberFormat` per locale. `formatMoney` runs on every keystroke
 * and basket render, and building a formatter is the expensive part; the instances
 * are immutable and safe to reuse. Keyed by locale (the only thing that varies).
 */
const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: string, l: string = "es-ES"): string {
  let formatter = formatters.get(l);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(l, { style: "currency", currency: "EUR" });
    formatters.set(l, formatter);
  }
  return formatter.format(Number(value));
}
