import { en, es, type StringKey } from "./strings.js";
import { makeT, registerCatalogue } from "@waitron/dashboard-kit";

// Registers the dashboard's base catalogue at load, before any t() runs.
export { setLocale, currentLocale, subscribeLocale, pickLocale } from "@waitron/dashboard-kit";

registerCatalogue({ en, es });

export const t = makeT<StringKey>();

/** Fills `{name}` placeholders; each value is inserted once, never re-read as a placeholder. */
export function fill(key: StringKey, values: Readonly<Record<string, string>>): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}
