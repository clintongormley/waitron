// The dashboard's shared i18n resolver: module-level locale state, a pub/sub for live switches, and a
// mutable catalogue registry. Lifted verbatim from apps/dashboard/src/i18n/t.ts (the locale state and
// pub/sub) with the strings.js-bound catalogue swapped for a registry a module fills at load — so a
// module UI can contribute its own strings without the kit importing the app's string table.

type Catalogue = Record<string, Record<string, string>>;

// The registry every t()/pickLocale() resolves against. English is the source of truth; a catalogue
// missing a key (or an unknown language) degrades to the English base, and t() finally degrades to the
// key so an unknown key renders as itself rather than undefined.
const catalogues: Catalogue = { en: {}, es: {} };

// The active locale for calls that don't pass one explicitly. The dashboard ships rendering Spanish for
// the deli, so the default is es-ES; setLocale swaps it. Module-level on purpose — a single-locale-at-a-
// time UI, not a multi-tenant server.
let locale = "es-ES";

type LocaleListener = () => void;
const localeListeners = new Set<LocaleListener>();

/** Subscribe to locale changes; returns a disposer. A LocaleChangeController requestUpdate()s on a live
 * switch (setLocale is module-global, so a switch must repaint the tree). */
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

/** Merge a module's strings into the registry. Called at module load, before any t(). */
export function registerCatalogue(cat: {
  en: Record<string, string>;
  es: Record<string, string>;
}): void {
  Object.assign(catalogues.en, cat.en);
  Object.assign(catalogues.es, cat.es);
}

/**
 * Translate a base key to the given locale (default: the active locale). The region subtag is stripped
 * ("es-ES" → "es"), then the language's catalogue if it has the key, else the English base, else the
 * key itself — so the return is always a string, never undefined.
 */
export function t(key: string, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return catalogues[lang]?.[key] ?? catalogues.en[key] ?? key;
}

/** A typed t() bound to a caller's own key union — the app narrows this to its StringKey. */
export function makeT<K extends string>(): (key: K, l?: string) => string {
  return (key, l) => t(key, l);
}

/**
 * Pick an `{ en, es }` entry's column for a locale: strip the region subtag ("es-ES" → "es"), then the
 * language's text if present, else the English base. The ONE place the region-strip + English-degrade
 * rule lives; the domain-name and error-code resolvers both call it, each supplying its own
 * missing-entry fallback around it.
 */
export function pickLocale(entry: { en: string; es: string }, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return (entry as Record<string, string>)[lang] ?? entry.en;
}

/** A `token → { en, es }` display-name table (roles, statuses, allergen codes, booking states, …). */
export type NameTable = Record<string, { en: string; es: string }>;

/**
 * Resolve an enum/domain TOKEN to its localised display name via a {@link NameTable}: an own-key check
 * then {@link pickLocale}'s region-strip + English-degrade; an unknown token renders as ITSELF. The
 * own-key check is `Object.hasOwn`, NOT truthiness — a token colliding with an Object.prototype member
 * (`toString`, `constructor`) would otherwise resolve the inherited member instead of the raw token.
 * The ONE home for this helper; the app's domain-name resolver and each module's own share it.
 */
export function resolveNameTable(table: NameTable, value: string, l: string = locale): string {
  return Object.hasOwn(table, value) ? pickLocale(table[value]!, l) : value;
}
