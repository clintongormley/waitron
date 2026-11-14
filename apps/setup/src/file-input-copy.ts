import type { FileInputCopy } from "@waitron/ui";
import { t } from "./i18n/t.js";

/** Called at render time so a language change redraws the picker's words. */
export function fileInputCopy(): FileInputCopy {
  return {
    drop: t("file_input.drop"),
    choose: t("file_input.choose"),
    replace: t("file_input.replace"),
    previewAlt: t("file_input.preview"),
  };
}
