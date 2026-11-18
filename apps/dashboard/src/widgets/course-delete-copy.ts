import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { countOf } from "./count-text.js";

export function courseDeleteCopy(): DeleteDialogCopy {
  return {
    heading: t("kitchen.delete_course"),
    refusals: t("printers.delete_refusals"),
    ends: t("printers.delete_ends"),
    removes: t("printers.delete_removes"),
    irreversible: t("printers.delete_irreversible"),
    cancel: t("action.cancel"),
    confirm: t("action.delete"),
    retry: t("printers.delete_retry"),
    loading: t("printers.delete_loading"),
    item: (item) => {
      switch (item.key) {
        case "course_service_steps":
          return countOf("kitchen.delete_course_service_steps", item.count);
        case "course_set_menu_lines":
          return countOf("kitchen.delete_course_set_menu_lines", item.count);
        case "course_set_menu_dishes":
          return countOf("kitchen.delete_course_set_menu_dishes", item.count);
        default:
          return countOf("kitchen.delete_course_products", item.count);
      }
    },
    refusal: (item) => codeMessage(item.code),
  };
}
