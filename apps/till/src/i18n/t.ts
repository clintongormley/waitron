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

/** `one` for a count of one, else `many` with its `{n}` filled in: the catalogues keep a singular as
 * a key of its own. */
export function countText(n: number, many: StringKey, one: StringKey): string {
  return n === 1 ? t(one) : t(many).replace("{n}", String(n));
}

/** `withName` with the person's name in its `{name}`, or `unnamed` when the server has no name for
 * them. */
export function named(name: string, withName: string, unnamed: string): string {
  return name === "" ? unnamed : withName.replace("{name}", () => name);
}

/** A sentence about `item` and the device carrying it: `withPerson` naming who is signed in there,
 * or `withDevice` when nobody is. Each `{item}`, `{device}` and `{person}` is filled in one pass,
 * so a name containing one of them is written as it is. */
export function carriedText(
  item: string,
  holder: { deviceName: string; personName: string | null },
  withDevice: StringKey,
  withPerson: StringKey,
): string {
  const values: Record<string, string> = {
    item,
    device: holder.deviceName,
    person: holder.personName ?? "",
  };
  return t(holder.personName === null ? withDevice : withPerson).replace(
    /\{(item|device|person)\}/g,
    (_whole, key: string) => values[key]!,
  );
}

/** The hour and minute of `at`, as the active locale writes a time of day. */
export function clockTime(at: Date | number): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Strips the region subtag ("es-ES" → "es"); a missing language degrades to the English text. */
export function pickLocale(entry: { en: string; es: string }, l: string = locale): string {
  const lang = l.replace(/-.*$/, "");
  return (entry as Record<string, string>)[lang] ?? entry.en;
}
