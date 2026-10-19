import { currentLocale } from "./i18n/t.js";

export const GUIDE_LINKS = {
  "products.selling-unit": { page: "products", section: "selling-unit" },
  "products.course": { page: "products", section: "course" },
  "products.variants": { page: "products", section: "variants" },
} as const;

export type GuideLink = keyof typeof GUIDE_LINKS;

/** `/help/<en|es>/<page>#<section>` in the dashboard's current language. */
export function guideHref(link: GuideLink, locale: string = currentLocale()): string {
  const { page, section } = GUIDE_LINKS[link];
  const lang = locale === "es" || locale.startsWith("es-") ? "es" : "en";
  return `/help/${lang}/${page}#${section}`;
}
