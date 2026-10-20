import { currentLocale } from "./i18n/t.js";

export const GUIDE_LINKS = {
  "products.nutrition-at-the-till": { page: "products", section: "nutrition-at-the-till" },
} as const;

export type GuideLink = keyof typeof GUIDE_LINKS;

/** `/help/<en|es>/<page>#<section>` in the till's current language. */
export function guideHref(link: GuideLink, locale: string = currentLocale()): string {
  const { page, section } = GUIDE_LINKS[link];
  const lang = locale === "es" || locale.startsWith("es-") ? "es" : "en";
  return `/help/${lang}/${page}#${section}`;
}
