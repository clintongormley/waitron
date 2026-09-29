import { WIZARD_LOCALE } from "../country-name.js";
import { catalogues, en, type StringKey } from "./strings.js";

// Module-level on purpose: the wizard shows one language at a time. setup-app sets it on connect,
// so this default governs only what renders before then.
let locale: string = WIZARD_LOCALE;

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

/** `t(key)` with each `{name}` filled from `params`; a placeholder with no value is left as written. */
export function format(key: StringKey, params: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
