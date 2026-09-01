import { t } from "./t.js";
import type { StringKey } from "./strings.js";
import type { Doneness } from "../api/client.js";

/**
 * The localised display label for a meat `doneness` value — its `doneness.<value>` i18n string. The ONE
 * place the `doneness.*` key is built, encapsulating the `as StringKey` cast the template-literal key
 * needs: the key is well-formed BY CONSTRUCTION (`value` is a `Doneness`, so `doneness.${value}` is
 * always a real catalogue key), so the cast is safe and no caller has to spell it — the same reason
 * {@link allergenName} owns the allergen-name lookup. `locale` defaults to the active locale, like
 * {@link t}, so the four render sites (the note picker, basket, station queue and expo) resolve the
 * label through this one helper instead of each re-casting the interpolated key.
 */
export function donenessLabel(value: Doneness, locale?: string): string {
  return t(`doneness.${value}` as StringKey, locale);
}
