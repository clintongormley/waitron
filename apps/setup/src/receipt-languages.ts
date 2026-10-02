import type { StringKey } from "./i18n/strings.js";

export const RECEIPT_LANGUAGES: Readonly<
  Record<string, { selectionLabel: StringKey; nativeName: string }>
> = {
  "es-ES": { selectionLabel: "venue.locale.es_es", nativeName: "Español" },
  "ca-ES": { selectionLabel: "venue.locale.ca_es", nativeName: "Català" },
  "gl-ES": { selectionLabel: "venue.locale.gl_es", nativeName: "Galego" },
  "eu-ES": { selectionLabel: "venue.locale.eu_es", nativeName: "Euskara" },
};
