import { t } from "../i18n/t.js";

/** A null count means the number of menus is still unknown. */
export function offMenusSentence(
  subject: "product.off_menus" | "folders.off_menus" | "folders.delete_off_menus",
  count: number | null,
): string {
  if (count === null) return t(`${subject}_unknown`);
  if (count === 0) return "";
  if (count === 1) return t(`${subject}_one`);
  return t(subject).replace("{count}", String(count));
}
