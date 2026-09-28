const formatters = new Map<string, Intl.NumberFormat>();

function euroFormatter(locale: string): Intl.NumberFormat {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    formatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * A decimal amount as `locale` writes euros, for display only: never store the result or do
 * arithmetic on it. `Number(value)` renders an amount to the cent up to fifteen significant digits,
 * and not reliably beyond.
 */
export function formatMoney(value: string, locale: string): string {
  const formatter = euroFormatter(locale);
  return formatter.format(Number(value));
}

export interface CurrencySymbol {
  symbol: string;
  side: "before" | "after";
}

/** The sign `locale` writes euros with, and which side of the amount it writes it. */
export function currencySymbol(locale: string): CurrencySymbol {
  const parts = euroFormatter(locale).formatToParts(9);
  const currency = parts.findIndex((part) => part.type === "currency");
  const integer = parts.findIndex((part) => part.type === "integer");
  return { symbol: parts[currency]!.value, side: currency < integer ? "before" : "after" };
}
