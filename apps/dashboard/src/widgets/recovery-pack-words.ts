import { html, type TemplateResult } from "lit";
import { dateTimeFormat } from "@waitron/dashboard-kit";
import type { RecoveryPackStatus } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
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

/**
 * The pack the status names as holding the current server key, and whether it reached a browser.
 * An unreceived holder comes first: its warning is the one a person must not miss.
 */
export function keyHolder(
  status: RecoveryPackStatus | null,
): { number: number; madeAt: string; received: boolean } | null {
  const unreceived = status?.unreceived;
  if (unreceived?.holdsCurrentServerKey)
    return { number: unreceived.number, madeAt: unreceived.madeAt, received: false };
  const kept = status?.keep.find((pack) => pack.why === "server_key");
  if (kept) return { number: kept.number, madeAt: kept.madeAt, received: true };
  return null;
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

/** Decision 10's words for a pack holding the current server key that never reached a browser. */
export function unreceivedWords(
  holder: { number: number; madeAt: string },
  timeZone: string | undefined,
): TemplateResult {
  return withStrong(
    "recovery_pack_dialog.unreceived",
    { number: String(holder.number), date: packDate(holder.madeAt, timeZone) },
    "option",
    t("recovery_pack_dialog.new_key"),
  );
}
