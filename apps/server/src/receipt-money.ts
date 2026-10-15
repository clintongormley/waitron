const moneyFormatters = new Map<string, Intl.NumberFormat>();
const rateFormatters = new Map<string, Intl.NumberFormat>();
const amountFormatters = new Map<string, Intl.NumberFormat>();

function cached(
  map: Map<string, Intl.NumberFormat>,
  locale: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  let formatter = map.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, options);
    map.set(locale, formatter);
  }
  return formatter;
}

/**
 * A money amount for paper, formatted in `locale`. `Intl.NumberFormat("es-ES", …)` separates the amount
 * and the € with a no-break space (U+00A0, or U+202F on some ICU builds); it becomes an ASCII space so
 * the printed line is the same on every ICU build. Basque ("eu-ES") writes a negative amount with the
 * minus sign U+2212, which the printer's glyph table lacks and would print as `?`; it becomes `-`.
 * `Number(value)` is display-only: it renders an amount to the cent up to fifteen significant digits,
 * and not reliably beyond.
 */
export function formatMoney(value: string, locale: string): string {
  return cached(moneyFormatters, locale, { style: "currency", currency: "EUR" })
    .format(Number(value))
    .replace(/[\u{a0}\u{202f}]/gu, " ")
    .replace(/\u{2212}/gu, "-");
}

/** A VAT rate as a receipt prints it: significant digits only, the locale's decimal mark, then "%". */
export function formatVatRate(rate: string, locale: string): string {
  return `${cached(rateFormatters, locale, { maximumFractionDigits: 2 }).format(Number(rate))}%`;
}

/** An amount in `locale` without the currency sign, with formatMoney's space and minus-sign replacements. */
export function formatAmount(value: string, locale: string): string {
  return cached(amountFormatters, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(value))
    .replace(/[\u{a0}\u{202f}]/gu, " ")
    .replace(/\u{2212}/gu, "-");
}
