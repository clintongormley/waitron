import { en, es, type StringKey } from "./strings.js";
import { makeT, registerCatalogue } from "@waitron/dashboard-kit";

// Registers the dashboard's base catalogue at load, before any t() runs.
export { setLocale, currentLocale, subscribeLocale, pickLocale } from "@waitron/dashboard-kit";

registerCatalogue({ en, es });

export const t = makeT<StringKey>();
