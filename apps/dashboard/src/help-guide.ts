import { currentLocale } from "./i18n/t.js";

export const GUIDE_LINKS = {
  "venue.time-zone": { page: "time-zone", section: "confirm" },
  "products.selling-unit": { page: "products", section: "selling-unit" },
  "products.course": { page: "products", section: "course" },
  "products.variants": { page: "products", section: "variants" },
  "products.patch-live-menu": { page: "products", section: "patch-live-menu" },
  "staff.own-data": { page: "staff", section: "own-data" },
  "box-status.free-space": { page: "box-status", section: "free-space" },
  "box-status.retry-now": { page: "box-status", section: "retry-now" },
  "box-status.clock-behind": { page: "box-status", section: "clock-behind" },
  "data-protection.staff-notice": { page: "data-protection", section: "staff-notice" },
} as const;

export type GuideLink = keyof typeof GUIDE_LINKS;

/** `/help/<en|es>/<page>#<section>` in the dashboard's current language. */
export function guideHref(link: GuideLink, locale: string = currentLocale()): string {
  const { page, section } = GUIDE_LINKS[link];
  const lang = locale === "es" || locale.startsWith("es-") ? "es" : "en";
  return `/help/${lang}/${page}#${section}`;
}
