import { formatMoney } from "@waitron/shared";
import { currentLocale, pickLocale } from "./i18n.js";

/** `{name}` is filled with the param as it is; `{name:money}` writes a decimal-string param as
 * euros, the way the alert's language writes them; `{name:list}` writes the words a registered
 * word list gives the param's value. */
export type AlertMessageTable = Readonly<
  Record<string, { readonly en: string; readonly es: string }>
>;

type Words = { readonly en: string; readonly es: string };

/** Words for each value a param can take, and `otherwise` for any value the list does not name. */
export type AlertWordLists = Readonly<
  Record<string, { readonly words: Readonly<Record<string, Words>>; readonly otherwise: Words }>
>;

// Unlike an error banner, an alert with no wording is still worth identifying, so the caller shows
// the raw code beside this sentence (see `hasAlertMessage`).
const GENERIC = { en: "Something needs attention", es: "Algo requiere atención" };

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
  const template = pickLocale(hasAlertMessage(code) ? messages[code]! : GENERIC, l);
  return template.replace(
    /\{([A-Za-z0-9_]+)(?::([a-z_]+))?\}/g,
    (_match, name: string, kind: string | undefined) => {
      const value = Object.hasOwn(params, name) ? params[name] : undefined;
      if (kind === "money") {
        return typeof value === "string" && DECIMAL.test(value)
          ? formatMoney(value, l)
          : formatParam(value);
      }
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
