import type { DeleteImpact } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

/** Built from the Themes card's live list: deleting a theme ends and removes nothing else. */
export function themeDeleteImpact(row: { id: string; name: string }, inUse: boolean): DeleteImpact {
  const target = { id: row.id, name: row.name };
  return {
    target,
    refusals: [],
    ends: inUse ? [{ key: "theme_in_use", count: 1, targets: [target] }] : [],
    removes: [],
  };
}

export function themeDeleteCopy(): DeleteDialogCopy {
  return {
    heading: t("appearance.delete_heading"),
    refusals: t("printers.delete_refusals"),
    ends: t("appearance.delete_changes"),
    removes: t("printers.delete_removes"),
    irreversible: t("printers.delete_irreversible"),
    cancel: t("action.cancel"),
    confirm: t("action.delete"),
    retry: t("printers.delete_retry"),
    loading: t("printers.delete_loading"),
    item: (item) => fill("appearance.delete_in_use", { name: item.targets[0]?.name ?? "" }),
    refusal: (item) => codeMessage(item.code),
  };
}
