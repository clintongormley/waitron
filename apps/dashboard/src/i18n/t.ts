import { catalogues, en, type StringKey } from "./strings.js";

// The active locale for calls that don't pass one explicitly. The dashboard ships
// rendering Spanish for the deli, so the default is es-ES; setLocale swaps it
// (e.g. an operator preference). This is module-level state on purpose — the
// dashboard is a single-locale-at-a-time UI, not a multi-tenant server.
let locale = "es-ES";

export function setLocale(l: string): void {
  locale = l;
}

export function currentLocale(): string {
  return locale;
}

/**
 * Translate a base key to the given locale (default: the active locale).
 *
 * Resolution: the locale's catalogue if it has the key, else the English base.
 * English is the source of truth, so `en[key]` is always defined and the
 * function cannot return undefined — an unknown locale, or a locale missing a
 * key, degrades to readable English rather than an empty string or a throw.
 */
export function t(key: StringKey, l: string = locale): string {
  return catalogues[l]?.[key] ?? en[key];
}
