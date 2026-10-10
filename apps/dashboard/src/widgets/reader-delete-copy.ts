import type { DeleteImpactItem, DeleteImpactRefusal, DeleteTarget } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";

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

const names = (targets: readonly DeleteTarget[]): string =>
  targets.map(({ name }) => name).join(", ");

function line(key: Counted, item: DeleteImpactItem): string {
  return fill(item.count === 1 ? (`${key}_one` as StringKey) : key, {
    count: String(item.count),
    names: names(item.targets),
  });
}

/** The card reader delete dialog's words, in the language the screen shows now. */
export function readerDeleteCopy(providerName: (providerId: string) => string): DeleteDialogCopy {
  function itemLine(item: DeleteImpactItem): string {
    const { key } = item;
    if (key === "provider_pairing")
      return fill("payments.delete_pairing", {
        provider: item.targets.map(({ id }) => providerName(id)).join(", "),
      });
    if (key === "reader_holder")
      return fill("payments.delete_holder", { names: names(item.targets) });
    const counted = Object.hasOwn(COUNTED, key) ? COUNTED[key] : undefined;
    if (counted !== undefined) return line(counted, item);
    return fill("payments.delete_unknown", {
      names: names(item.targets),
      count: String(item.count),
    }).trim();
  }

  function refusalLine(refusal: DeleteImpactRefusal): string {
    const named = names(refusal.targets);
    if (refusal.code === "reader.payment_in_progress")
      return named
        ? fill("payments.delete_paying", { names: named })
        : t("payments.delete_paying_unnamed");
    if (refusal.code === "reader.provider_disconnected")
      return fill("payments.delete_connect_first", {
        provider: providerName(String(refusal.params.providerId)),
      });
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
