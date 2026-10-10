import type { DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";

const NAMED: Record<string, StringKey> = {
  held_printers: "devices.delete_held",
  held_readers: "devices.delete_held",
  printer_choices: "devices.delete_printer_choices",
  made_here_stations: "devices.delete_made_here",
  approved_profiles: "devices.delete_approved_profiles",
  card_reader: "devices.delete_card_reader",
};

const COUNTED: Record<string, "devices.delete_sessions" | "devices.delete_kitchen_screens"> = {
  sessions: "devices.delete_sessions",
  kitchen_screens: "devices.delete_kitchen_screens",
};

const names = (targets: DeleteImpactItem["targets"]): string =>
  targets.map(({ name }) => name).join(", ");

function itemLine(item: DeleteImpactItem): string {
  const { key, count, targets } = item;
  const named = Object.hasOwn(NAMED, key) ? NAMED[key] : undefined;
  if (named) return fill(named, { names: names(targets) });
  const counted = Object.hasOwn(COUNTED, key) ? COUNTED[key] : undefined;
  if (counted) return fill(count === 1 ? `${counted}_one` : counted, { count: String(count) });
  if (key === "join_request") return t("devices.delete_join_request");
  return fill("devices.delete_unknown", { names: names(targets), count: String(count) }).trim();
}

function refusalLine(refusal: DeleteImpactRefusal): string {
  const named = names(refusal.targets);
  if (refusal.code === "device.payment_in_progress")
    return fill("devices.delete_payment", { names: named }).replace(/:\s*$/, "");
  const message = codeMessage(refusal.code);
  return named ? `${message.replace(/\.$/, "")}: ${named}` : message;
}

/** The device delete dialog's words, in the language the screen shows now. */
export function deviceDeleteCopy(): DeleteDialogCopy {
  return {
    heading: t("devices.delete_heading"),
    refusals: t("devices.delete_refusals"),
    ends: t("devices.delete_ends"),
    removes: t("devices.delete_removes"),
    irreversible: t("devices.delete_irreversible"),
    cancel: t("action.cancel"),
    confirm: t("action.delete"),
    retry: t("devices.delete_retry"),
    loading: t("devices.delete_loading"),
    item: itemLine,
    refusal: refusalLine,
  };
}
