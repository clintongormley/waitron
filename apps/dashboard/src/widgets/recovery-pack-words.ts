import { dateTimeFormat } from "@waitron/dashboard-kit";
import { currentLocale } from "../i18n/t.js";

/**
 * A pack's day as the screen language writes it, in the venue's zone as the pack's own pages are
 * dated: "12 October", "12 de octubre".
 */
export function packDate(iso: string, timeZone: string | undefined): string {
  return dateTimeFormat(currentLocale(), { day: "numeric", month: "long", timeZone }).format(
    new Date(iso),
  );
}

/** A whole date, "23 December 2026", "23 de diciembre de 2026", in the venue's zone. */
export function keepDate(iso: string, timeZone: string | undefined): string {
  return dateTimeFormat(currentLocale(), { dateStyle: "long", timeZone }).format(new Date(iso));
}
