import type { TileRef } from "@waitron/catalogue/src/section-types.js";
import { t } from "../i18n/t.js";

/** A member's staff-facing name, or a placeholder when the product or section is not known here. */
export function memberName(
  ref: TileRef,
  productNames: ReadonlyMap<string, string>,
  sectionNames: ReadonlyMap<string, string>,
): string {
  if (ref.kind === "missing") return ref.name;
  const name =
    ref.kind === "product" ? productNames.get(ref.productId) : sectionNames.get(ref.sectionId);
  return name ?? t("members.missing");
}

export function memberKindLabel(ref: TileRef): string {
  if (ref.kind === "missing") return t("members.missing");
  return t(ref.kind === "product" ? "members.kind_product" : "members.kind_section");
}
