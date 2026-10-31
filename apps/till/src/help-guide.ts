import { currentLocale } from "./i18n/t.js";

export const GUIDE_LINKS = {
  "products.nutrition-at-the-till": { page: "products", section: "nutrition-at-the-till" },
  "kitchen-service.kitchen-screen": { page: "kitchen-service", section: "kitchen-screen" },
  "kitchen-service.corrections": { page: "kitchen-service", section: "corrections" },
  "kitchen-service.service-lifetime": { page: "kitchen-service", section: "service-lifetime" },
} as const;

export type GuideLink = keyof typeof GUIDE_LINKS;

/** `/help/<en|es>/<page>#<section>` in the till's current language. */
export function guideHref(link: GuideLink, locale: string = currentLocale()): string {
  const { page, section } = GUIDE_LINKS[link];
  const lang = locale === "es" || locale.startsWith("es-") ? "es" : "en";
  return `/help/${lang}/${page}#${section}`;
}
