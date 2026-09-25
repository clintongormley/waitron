import { FALLBACK_LOCALE } from "@waitron/shared";
import { catalogues, en, type StringKey } from "./strings.js";

// Module-level on purpose: the till shows one locale at a time. till-app switches it at boot, so this
// default governs only what renders before then.
let locale: string = FALLBACK_LOCALE;

type LocaleListener = () => void;
const localeListeners = new Set<LocaleListener>();

/** Returns a disposer. */
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

/** An unknown locale, or one missing the key, degrades to the English text. */
export function t(key: StringKey, l: string = locale): string {
  return catalogues[l]?.[key] ?? en[key];
}

/** Strips the region subtag ("es-ES" → "es"); a missing language degrades to the English text. */
export function pickLocale(entry: { en: string; es: string }, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return (entry as Record<string, string>)[lang] ?? entry.en;
}
