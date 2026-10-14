import type { DeleteImpactItem } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { t, tf, type StringKey } from "./strings.js";

const counted = (one: StringKey, other: StringKey, count: number, names = "") =>
  tf(count === 1 ? one : other, { count: String(count), names });

/** The server's only removed items are a role's painted blocks and its holders. */
function removed(item: DeleteImpactItem): string {
  if (item.key === "staff_role_holders")
    return counted(
      "staffing.role.delete_holders_one",
      "staffing.role.delete_holders_other",
      item.count,
      item.targets.map((target) => target.name).join(", "),
    );
  return counted(
    "staffing.role.delete_blocks_one",
    "staffing.role.delete_blocks_other",
    item.count,
  );
}

/** The words of the staff-role delete question; its one refusal is `staff_role.in_use`. */
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
    refusal: (refusal) =>
      counted(
        "staffing.role.delete_shifts_one",
        "staffing.role.delete_shifts_other",
        Number(refusal.params.shiftCount),
      ),
  };
}
