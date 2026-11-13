import { currentLocale } from "./i18n/t.js";

export const GUIDE_LINKS = {
  "table-service.pay-window": { page: "table-service", section: "pay-window" },
  "table-service.correct-invoice": { page: "table-service", section: "correct-invoice" },
  "products.nutrition-at-the-till": { page: "products", section: "nutrition-at-the-till" },
  "kitchen-service.kitchen-screen": { page: "kitchen-service", section: "kitchen-screen" },
  "kitchen-service.corrections": { page: "kitchen-service", section: "corrections" },
  "kitchen-service.pass-screen": { page: "kitchen-service", section: "pass-screen" },
  "kitchen-service.after-period": { page: "kitchen-service", section: "after-period" },
  "table-service.ready-bar": { page: "table-service", section: "ready-bar" },
  "table-service.service-steps": { page: "table-service", section: "service-steps" },
  "table-service.deferred-payment": { page: "table-service", section: "deferred-payment" },
} as const;

export type GuideLink = keyof typeof GUIDE_LINKS;

/** `/help/<en|es>/<page>#<section>` in the till's current language. */
export function guideHref(link: GuideLink, locale: string = currentLocale()): string {
  const { page, section } = GUIDE_LINKS[link];
  const lang = locale === "es" || locale.startsWith("es-") ? "es" : "en";
  return `/help/${lang}/${page}#${section}`;
}
