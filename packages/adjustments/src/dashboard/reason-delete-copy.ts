import { codeMessage } from "@waitron/dashboard-kit";
import type { DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { t, tf } from "./strings.js";

function named(item: DeleteImpactItem): string {
  return tf("adjustments.delete_item", {
    names: item.targets.map((target) => target.name).join(", "),
    count: String(item.count),
  }).trim();
}

// The impact read sends `withNote` as 0 or 1; a refused DELETE sends it as false or true.
function refused(refusal: DeleteImpactRefusal): string {
  if (refusal.code === "adjustment_reason.void_required")
    return t(
      refusal.params.withNote
        ? "adjustments.error.void_required_note"
        : "adjustments.error.void_required",
    );
  return codeMessage(refusal.code);
}

/** The words of the reason delete question. */
export function reasonDeleteCopy(): DeleteDialogCopy {
  return {
    heading: t("adjustments.delete_heading"),
    refusals: t("adjustments.delete_refusals"),
    ends: t("adjustments.delete_ends"),
    removes: t("adjustments.delete_removes"),
    irreversible: t("adjustments.delete_irreversible"),
    cancel: t("adjustments.cancel"),
    confirm: t("adjustments.delete"),
    retry: t("adjustments.delete_retry"),
    loading: t("adjustments.delete_loading"),
    item: named,
    refusal: refused,
  };
}
