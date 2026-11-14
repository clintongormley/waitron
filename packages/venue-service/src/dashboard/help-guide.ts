import { currentLocale } from "@waitron/dashboard-kit";

export const GUIDE_LINKS = {
  "opening-hours": { page: "opening-hours", section: "select-days" },
} as const;

export function guideHref(link: keyof typeof GUIDE_LINKS): string {
  const { page, section } = GUIDE_LINKS[link];
  const language = currentLocale().split("-")[0] === "es" ? "es" : "en";
  return `/help/${language}/${page}#${section}`;
}
