const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A money amount for paper, formatted in `locale`. `Intl.NumberFormat("es-ES", …)` separates the amount
 * and the € with a no-break space (U+00A0, or U+202F on some ICU builds); it becomes an ASCII space so
 * the printed line is the same on every ICU build. Basque ("eu-ES") writes a negative amount with the
 * minus sign U+2212, which the printer's glyph table lacks and would print as `?`; it becomes `-`.
 * `Number(value)` is display-only: it renders an amount to the cent up to fifteen significant digits,
 * and not reliably beyond.
 */
export function formatMoney(value: string, locale: string): string {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    formatters.set(locale, formatter);
  }
  return formatter
    .format(Number(value))
    .replace(/[\u{a0}\u{202f}]/gu, " ")
    .replace(/\u{2212}/gu, "-");
}
