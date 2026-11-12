import type { DeleteDialogCopy } from "@waitron/ui";
import { t, tf } from "./strings.js";

export function staffRoleDeleteCopy(holderCount: number): DeleteDialogCopy {
  return {
    heading: t("staffing.role.delete_heading"),
    refusals: "",
    ends: "",
    removes: "",
    irreversible: tf(
      holderCount === 1 ? "staffing.role.delete_question_one" : "staffing.role.delete_question",
      { count: String(holderCount) },
    ),
    cancel: t("staffing.role.cancel"),
    confirm: t("staffing.role.delete"),
    retry: "",
    loading: "",
    item: () => "",
    refusal: () => "",
  };
}
