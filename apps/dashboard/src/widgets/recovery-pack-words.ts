import { html, type TemplateResult } from "lit";
import { dateTimeFormat } from "@waitron/dashboard-kit";
import { currentLocale, fill } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

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

/** `key`'s words with `{name}` drawn in bold as `strong`, every other placeholder filled. */
export function withStrong(
  key: StringKey,
  values: Readonly<Record<string, string>>,
  name: string,
  strong: string,
): TemplateResult {
  const [before, after] = fill(key, values).split(`{${name}}`);
  return html`${before}<strong>${strong}</strong>${after ?? ""}`;
}
