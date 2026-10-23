import { formatMoney } from "@waitron/shared";
import { formatIsoMinute } from "./date-format.js";
import { currentLocale, pickLocale } from "./i18n.js";
import { GENERIC_ALERT } from "./strings.js";

/** `{name}` is filled with the param as it is; `{name:money}` writes a decimal-string param as
 * euros, the way the alert's language writes them; `{name:date}` writes a `YYYY-MM-DD` param as
 * that calendar day, the way the alert's language writes it; `{name:bytes}` writes a number of
 * bytes as gigabytes or megabytes, the way the alert's language writes them; `{name:minute}` writes
 * an instant in `toISOString`'s shape as `YYYY-MM-DD HH:MM` in the browser's zone, in either
 * language; `{name:list}` writes the words a registered word list gives the param's value. */
export type AlertMessageTable = Readonly<
  Record<string, { readonly en: string; readonly es: string }>
>;

type Words = { readonly en: string; readonly es: string };

/** Words for each value a param can take, and `otherwise` for any value the list does not name. */
export type AlertWordLists = Readonly<
  Record<string, { readonly words: Readonly<Record<string, Words>>; readonly otherwise: Words }>
>;

const messages: Record<string, { en: string; es: string }> = {};
const wordLists: Record<string, AlertWordLists[string]> = {};

export function registerAlertMessages(table: AlertMessageTable): void {
  Object.assign(messages, table);
}

export function registerAlertWords(lists: AlertWordLists): void {
  Object.assign(wordLists, lists);
}

export function hasAlertMessage(code: string): boolean {
  return Object.hasOwn(messages, code);
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_LOCALES = { en: "en-GB", es: "es-ES" };

// `en` alone writes "Oct 25, 2026"; the alert's wording is written for "25 Oct 2026". The day is
// read and written at UTC so the reader's own zone cannot move it.
function formatDay(value: unknown, l: string): string {
  const m = typeof value === "string" ? DAY.exec(value) : null;
  if (!m) return "—";
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (at.toISOString().slice(0, 10) !== value) return "—";
  return new Intl.DateTimeFormat(pickLocale(DAY_LOCALES, l), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
}

function formatMinute(value: unknown): string {
  if (typeof value !== "string") return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== value) return "—";
  return formatIsoMinute(value);
}

export function formatBytes(value: unknown, l: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const v = Math.max(0, value);
  const locale = pickLocale(DAY_LOCALES, l);
  return Math.round(v / 1e6) >= 1000
    ? new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "gigabyte",
        maximumFractionDigits: 1,
      }).format(v / 1e9)
    : new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "megabyte",
        maximumFractionDigits: 0,
      }).format(v / 1e6);
}

function formatParam(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

export function alertMessage(
  code: string,
  params: Readonly<Record<string, unknown>>,
  l: string = currentLocale(),
): string {
  const template = pickLocale(hasAlertMessage(code) ? messages[code]! : GENERIC_ALERT, l);
  return template.replace(
    /\{([A-Za-z0-9_]+)(?::([a-z_]+))?\}/g,
    (_match, name: string, kind: string | undefined) => {
      const value = Object.hasOwn(params, name) ? params[name] : undefined;
      if (kind === "money") {
        return typeof value === "string" && DECIMAL.test(value)
          ? formatMoney(value, l)
          : formatParam(value);
      }
      if (kind === "date") return formatDay(value, l);
      if (kind === "bytes") return formatBytes(value, l);
      if (kind === "minute") return formatMinute(value);
      if (kind === undefined) return formatParam(value);
      if (!Object.hasOwn(wordLists, kind)) return formatParam(null);
      const list = wordLists[kind]!;
      return pickLocale(
        typeof value === "string" && Object.hasOwn(list.words, value)
          ? list.words[value]!
          : list.otherwise,
        l,
      );
    },
  );
}
