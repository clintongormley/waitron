import type { StringKey } from "./i18n/strings.js";

export const RECEIPT_LANGUAGES: Readonly<Record<string, { selectionLabel: StringKey }>> = {
  "es-ES": { selectionLabel: "venue.locale.es_es" },
  "ca-ES": { selectionLabel: "venue.locale.ca_es" },
  "gl-ES": { selectionLabel: "venue.locale.gl_es" },
  "eu-ES": { selectionLabel: "venue.locale.eu_es" },
};
