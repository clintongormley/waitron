import { FALLBACK_LOCALE, formatMoney } from "@waitron/shared";
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

export function overLimitText(limit: string): string {
  return t("sale.over_simplified_limit").replace("{amount}", () => formatMoney(limit, locale));
}

/** A `clock.unusable` refusal's reading, when {@link clockUnusableText} can date it. */
export function clockReadingOf(refusal: {
  clockAt?: unknown;
  offsetMinutes?: unknown;
}): { clockAt: string; offsetMinutes: number } | undefined {
  const { clockAt, offsetMinutes } = refusal;
  return typeof clockAt === "string" &&
    Number.isFinite(Date.parse(clockAt)) &&
    typeof offsetMinutes === "number" &&
    Number.isFinite(offsetMinutes)
    ? { clockAt, offsetMinutes }
    : undefined;
}

/** `clockAt`'s date in the reading's own offset, the one the record would carry, never the till's
 * own time zone. */
export function clockUnusableText(clockAt: string, offsetMinutes: number): string {
  const date = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.parse(clockAt) + offsetMinutes * 60_000));
  return t("sale.clock_unusable").replace("{date}", () => date);
}

export interface ClockBehind {
  clockAt: string;
  offsetMinutes: number;
  lastRecordAt: string;
  lastRecordOffsetMinutes: number;
}

/** A `clock.behind_chain` refusal's two readings, when {@link clockBehindText} can write both. */
export function clockBehindOf(refusal: {
  clockAt?: unknown;
  offsetMinutes?: unknown;
  lastRecordAt?: unknown;
  lastRecordOffsetMinutes?: unknown;
}): ClockBehind | undefined {
  const clock = clockReadingOf(refusal);
  const last = clockReadingOf({
    clockAt: refusal.lastRecordAt,
    offsetMinutes: refusal.lastRecordOffsetMinutes,
  });
  return clock === undefined || last === undefined
    ? undefined
    : {
        ...clock,
        lastRecordAt: last.clockAt,
        lastRecordOffsetMinutes: last.offsetMinutes,
      };
}

/** Date and time apart and joined with a space: `en-GB`'s combined format puts a comma between. */
function readingText(at: string, offsetMinutes: number): string {
  const shifted = new Date(Date.parse(at) + offsetMinutes * 60_000);
  const date = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(shifted);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(shifted);
  return `${date} ${time}`;
}

/** Each reading in its own offset, the one its record carries or would carry. */
export function clockBehindText(behind: ClockBehind): string {
  const clockAt = readingText(behind.clockAt, behind.offsetMinutes);
  const lastRecordAt = readingText(behind.lastRecordAt, behind.lastRecordOffsetMinutes);
  return t("sale.clock_behind_chain")
    .replace("{clockAt}", () => clockAt)
    .replace("{lastRecordAt}", () => lastRecordAt);
}

export function differentPeopleText(limit: string): string {
  return t("table.confirm_different_people").replace("{amount}", () => formatMoney(limit, locale));
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
  return Object.hasOwn(entry, lang)
    ? ((entry as Record<string, string>)[lang] ?? entry.en)
    : entry.en;
}
