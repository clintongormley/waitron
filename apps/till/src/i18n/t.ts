import { FALLBACK_LOCALE } from "@waitron/shared";
import { catalogues, en, type StringKey } from "./strings.js";

// The active locale for calls that don't pass one explicitly. Defaults to FALLBACK_LOCALE (en-GB) — the
// neutral English source-of-truth in @waitron/shared — matching the product/demo default. A Spanish
// venue is driven to es-ES at boot when till-app reads the venue's derived locale and calls setLocale
// (see @waitron/shared resolveVenueLocale). So this default governs the pre-login/lock render and any
// call made before that boot switch. Module-level state on purpose — the till is a single-locale-at-a-
// time UI, not a multi-tenant server. Typed `string` because setLocale reassigns it to any locale code.
let locale: string = FALLBACK_LOCALE;

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
 * allergen-name and error-code resolvers both call it, and each supplies its own
 * missing-entry fallback (the raw code / the GENERIC message) around it.
 */
export function pickLocale(entry: { en: string; es: string }, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return (entry as Record<string, string>)[lang] ?? entry.en;
}
