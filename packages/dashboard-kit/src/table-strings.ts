import { currentLocale, pickLocale } from "./i18n.js";

const NO_MATCHES = {
  en: "Nothing matches your search or filters.",
  es: "Nada coincide con tu búsqueda ni con tus filtros.",
};

/** What every dashboard table says when its search or its filters hide every row. */
export function tableNoMatches(l: string = currentLocale()): string {
  return pickLocale(NO_MATCHES, l);
}
