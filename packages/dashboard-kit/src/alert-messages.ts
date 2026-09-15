import { currentLocale, pickLocale } from "./i18n.js";

export type AlertMessageTable = Readonly<
  Record<string, { readonly en: string; readonly es: string }>
>;

// Unlike an error banner, an alert with no wording is still worth identifying, so the caller shows
// the raw code beside this sentence (see `hasAlertMessage`).
const GENERIC = { en: "Something needs attention", es: "Algo requiere atención" };

const messages: Record<string, { en: string; es: string }> = {};

export function registerAlertMessages(table: AlertMessageTable): void {
  Object.assign(messages, table);
}

export function hasAlertMessage(code: string): boolean {
  return Object.hasOwn(messages, code);
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
  const template = pickLocale(hasAlertMessage(code) ? messages[code]! : GENERIC, l);
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) =>
    formatParam(Object.hasOwn(params, name) ? params[name] : undefined),
  );
}
