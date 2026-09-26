const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A decimal amount as `locale` writes euros, for display only: never store the result or do
 * arithmetic on it. `Number(value)` renders an amount to the cent up to fifteen significant digits,
 * and not reliably beyond. One formatter is kept per locale.
 */
export function formatMoney(value: string, locale: string): string {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    formatters.set(locale, formatter);
  }
  return formatter.format(Number(value));
}
