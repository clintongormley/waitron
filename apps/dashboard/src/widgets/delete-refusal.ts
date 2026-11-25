import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

function names(params: unknown, key: string): string[] {
  if (params === null || typeof params !== "object") return [];
  const rows = (params as Record<string, unknown>)[key];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (row === null || typeof row !== "object") return [];
    const name = (row as { name?: unknown }).name;
    return typeof name === "string" ? [name] : [];
  });
}

export function refusalText(
  code: string,
  params: unknown,
  options: { includeSingleProduct?: boolean } = {},
): string {
  const sentence = codeMessage(code);
  if (code === "product.offered_as_extra") {
    const lists = names(params, "extraLists");
    return lists.length ? `${sentence} ${lists.join(", ")}` : sentence;
  }
  if (code !== "product.on_live_menu") return sentence;
  const products = names(params, "products");
  const menus = names(params, "menus");
  return (
    sentence +
    (products.length && (products.length > 1 || options.includeSingleProduct)
      ? ` ${t("product.refusal_products")}: ${products.join(", ")}.`
      : "") +
    (menus.length ? ` ${t("product.refusal_menus")}: ${menus.join(", ")}.` : "")
  );
}
