import type { DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { countedDeleteLine, deleteTargetNames } from "./delete-copy-lines.js";

type Counted =
  | "payments.delete_device_reader"
  | "payments.delete_device_default"
  | "payments.delete_profile_reader"
  | "payments.delete_profile_default";

const COUNTED: Readonly<Record<string, Counted>> = {
  device_reader: "payments.delete_device_reader",
  device_reader_default: "payments.delete_device_default",
  profile_reader: "payments.delete_profile_reader",
  profile_reader_default: "payments.delete_profile_default",
};

/** The card reader delete dialog's words, in the language the screen shows now. */
export function readerDeleteCopy(providerName: (providerId: string) => string): DeleteDialogCopy {
  function itemLine(item: DeleteImpactItem): string {
    const { key } = item;
    if (key === "provider_pairing")
      return fill("payments.delete_pairing", {
        provider: item.targets.map(({ id }) => providerName(id)).join(", "),
      });
    if (key === "provider_registration_kept")
      return fill("payments.delete_kept_at_provider", {
        provider: item.targets.map(({ id }) => providerName(id)).join(", "),
      });
    if (key === "provider_registration_stays")
      return fill("payments.delete_stays_at_provider", {
        provider: item.targets.map(({ id }) => providerName(id)).join(", "),
      });
    if (key === "reader_holder")
      return fill("payments.delete_holder", { names: deleteTargetNames(item.targets) });
    const counted = Object.hasOwn(COUNTED, key) ? COUNTED[key] : undefined;
    if (counted !== undefined) return countedDeleteLine(counted, item);
    return fill("payments.delete_unknown", {
      names: deleteTargetNames(item.targets),
      count: String(item.count),
    }).trim();
  }

  function refusalLine(refusal: DeleteImpactRefusal): string {
    const named = deleteTargetNames(refusal.targets);
    if (refusal.code === "reader.payment_in_progress")
      return named
        ? fill("payments.delete_paying", { names: named })
        : t("payments.delete_paying_unnamed");
    const message = codeMessage(refusal.code);
    return named ? `${message.replace(/\.$/, "")}: ${named}` : message;
  }

  return {
    heading: t("payments.delete_heading"),
    refusals: t("payments.delete_refusals"),
    ends: t("payments.delete_ends"),
    removes: t("payments.delete_removes"),
    irreversible: t("payments.delete_irreversible"),
    cancel: t("action.cancel"),
    confirm: t("action.delete"),
    retry: t("payments.delete_retry"),
    loading: t("payments.delete_loading"),
    item: itemLine,
    refusal: refusalLine,
  };
}
