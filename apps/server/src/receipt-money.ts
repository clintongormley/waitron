const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A money amount for paper, formatted in `locale`. `Intl.NumberFormat("es-ES", …)` separates the amount
 * and the € with a no-break space (U+00A0, or U+202F on some ICU builds); it becomes an ASCII space so
 * every character set prints the same gap. `Number(value)` is display-only: it renders an amount to
 * the cent up to fifteen significant digits, and not reliably beyond.
 */
export function formatMoney(value: string, locale: string): string {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    formatters.set(locale, formatter);
  }
  return formatter.format(Number(value)).replace(/[\u{a0}\u{202f}]/gu, " ");
}
