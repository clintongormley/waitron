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

type KeyHolder = { number: number; madeAt: string; received: boolean; offeredAtSetup?: true };

/** A later pack that leaves the key in place cannot hide the unconfirmed pack that holds it. */
export function keyHolder(status: RecoveryPackStatus | null): KeyHolder | null {
  const unreceived = status?.unreceived;
  if (unreceived?.holdsCurrentServerKey)
    return {
      number: unreceived.number,
      madeAt: unreceived.madeAt,
      received: false,
      ...(unreceived.offeredAtSetup ? { offeredAtSetup: true } : {}),
    };
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

export function unreceivedWords(
  holder: Omit<KeyHolder, "received">,
  timeZone: string | undefined,
): TemplateResult {
  const date = packDate(holder.madeAt, timeZone);
  if (holder.offeredAtSetup) return html`${fill("recovery_pack.offered_at_setup", { date })}`;
  return withStrong(
    "recovery_pack_dialog.unreceived",
    { number: String(holder.number), date },
    "option",
    t("recovery_pack_dialog.new_key"),
  );
}
