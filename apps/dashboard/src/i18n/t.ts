import { catalogues, en, type StringKey } from "./strings.js";

// The active locale for calls that don't pass one explicitly. The dashboard ships
// rendering Spanish for the deli, so the default is es-ES; setLocale swaps it
// (e.g. an operator preference). This is module-level state on purpose — the
// dashboard is a single-locale-at-a-time UI, not a multi-tenant server.
let locale = "es-ES";

type LocaleListener = () => void;
const localeListeners = new Set<LocaleListener>();

/** Subscribe to locale changes; returns a disposer. Mirrors the working-order
 * store's pub/sub so a LocaleChangeController can requestUpdate() on a live
 * switch (setLocale is module-global; a switch must repaint the tree). */
export function subscribeLocale(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function setLocale(l: string): void {
  locale = l;
  for (const listener of localeListeners) listener();
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

/**
 * Pick an `{ en, es }` entry's column for a locale: strip the region subtag
 * ("es-ES" → "es"), then the language's text if present, else the English base.
 * This is the ONE place the region-strip + English-degrade rule lives; the
 * domain-name and error-code resolvers both call it, and each supplies its own
 * missing-entry fallback (the raw token / the GENERIC message) around it.
 */
export function pickLocale(entry: { en: string; es: string }, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return (entry as Record<string, string>)[lang] ?? entry.en;
}
