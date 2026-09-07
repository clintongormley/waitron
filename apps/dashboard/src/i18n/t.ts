import { en, es, type StringKey } from "./strings.js";
import { makeT, registerCatalogue } from "@waitron/dashboard-kit";

// The locale state, pub/sub, and pickLocale resolver now live in @waitron/dashboard-kit (shared with
// the till and any module UI). This module registers the dashboard's base catalogue at load — before
// any t() runs — and re-exports the kit's locale surface so the app's ~40 `./t.js` importers are
// unchanged.
export { setLocale, currentLocale, subscribeLocale, pickLocale } from "@waitron/dashboard-kit";

registerCatalogue({ en, es });

/** Translate a base key to the given locale (default: the active locale), typed to the app's StringKey
 * union so an unknown key is a compile error. Resolution (region-strip, English-degrade) is the kit's. */
export const t = makeT<StringKey>();
