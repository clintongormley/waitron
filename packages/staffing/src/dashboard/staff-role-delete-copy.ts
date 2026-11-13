import type { DeleteDialogCopy } from "@waitron/ui";
import { t, tf } from "./strings.js";

export function staffRoleDeleteCopy(
  holderCount: number,
  profiles: readonly { name: string }[] = [],
): DeleteDialogCopy {
  return {
    heading: t("staffing.role.delete_heading"),
    refusals: "",
    ends: "",
    removes: "",
    irreversible:
      tf(
        holderCount === 1 ? "staffing.role.delete_question_one" : "staffing.role.delete_question",
        { count: String(holderCount) },
      ) +
      (profiles.length
        ? " " +
          tf("staffing.role.empty_devices", { profiles: profiles.map((p) => p.name).join(", ") })
        : ""),
    cancel: t("staffing.role.cancel"),
    confirm: t("staffing.role.delete"),
    retry: t("staffing.role.retry"),
    loading: t("staffing.role.loading"),
    item: () => "",
    refusal: () => "",
  };
}
