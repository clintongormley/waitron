import type { DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

const names = (targets: DeleteImpactItem["targets"]): string =>
  targets.map(({ name }) => name).join(", ");

function itemLine(item: DeleteImpactItem): string {
  const { key, count, targets } = item;
  if (key === "held_printers" || key === "held_readers")
    return fill("devices.delete_held", { names: names(targets) });
  if (key === "sessions")
    return fill(count === 1 ? "devices.delete_sessions_one" : "devices.delete_sessions", {
      count: String(count),
    });
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
