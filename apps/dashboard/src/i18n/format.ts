import { currentLocale } from "./t.js";

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A decimal amount as the person's locale writes euros, for display only: never store the result or
 * do arithmetic on it. `Number(value)` renders an amount to the cent up to fifteen significant
 * digits. The till's twin is `apps/till/src/i18n/format.ts`.
 */
export function formatMoney(value: string, l: string = currentLocale()): string {
  let formatter = formatters.get(l);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(l, { style: "currency", currency: "EUR" });
    formatters.set(l, formatter);
  }
  return formatter.format(Number(value));
}
