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
    item: (item) => countOf("kitchen.delete_course_products", item.count),
    refusal: (item) => codeMessage(item.code),
  };
}
