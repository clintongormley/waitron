import { codeMessage } from "@waitron/dashboard-kit";
import type { DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { t, tf, type StringKey } from "./strings.js";

const counted = (one: StringKey, other: StringKey, count: number, names = "") =>
  tf(count === 1 ? one : other, { count: String(count), names });

const namesOf = (targets: DeleteImpactItem["targets"]) =>
  targets.map((target) => target.name).join(", ");

function removed(item: DeleteImpactItem): string {
  if (item.key === "staff_role_blocks")
    return counted(
      "staffing.role.delete_blocks_one",
      "staffing.role.delete_blocks_other",
      item.count,
    );
  if (item.key === "staff_role_holders")
    return counted(
      "staffing.role.delete_holders_one",
      "staffing.role.delete_holders_other",
      item.count,
      namesOf(item.targets),
    );
  return tf("staffing.role.delete_other", {
    names: namesOf(item.targets),
    count: String(item.count),
  }).trim();
}

function refused(refusal: DeleteImpactRefusal): string {
  if (refusal.code === "staff_role.in_use")
    return counted(
      "staffing.role.delete_shifts_one",
      "staffing.role.delete_shifts_other",
      Number(refusal.params.shiftCount),
    );
  return codeMessage(refusal.code);
}

/** The words of the staff-role delete question. */
export function staffRoleDeleteCopy(): DeleteDialogCopy {
  return {
    heading: t("staffing.role.delete_heading"),
    refusals: t("staffing.role.delete_refusals"),
    ends: t("staffing.role.delete_ends"),
    removes: t("staffing.role.delete_removes"),
    irreversible: t("staffing.role.delete_irreversible"),
    cancel: t("staffing.role.cancel"),
    confirm: t("staffing.role.delete"),
    retry: t("staffing.role.delete_retry"),
    loading: t("staffing.role.delete_loading"),
    item: removed,
    refusal: refused,
  };
}
