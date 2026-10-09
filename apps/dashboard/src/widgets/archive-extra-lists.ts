import { html, nothing } from "lit";
import type { ExtraList, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

export function archiveExtraListWarning(
  products: readonly Product[],
  productIds: readonly string[],
  lists: readonly ExtraList[],
) {
  const selected = new Set(productIds);
  const removed = new Set<string>();
  for (const product of products) {
    if (!product.active) continue;
    if (selected.has(product.id)) removed.add(product.id);
    for (const variant of product.variants)
      if (variant.active && (selected.has(product.id) || selected.has(variant.id)))
        removed.add(variant.id);
  }
  const names = [
    ...new Set(
      lists
        .filter((list) => list.items.some((item) => removed.has(item.productId)))
        .map((list) => list.name),
    ),
  ];
  return names.length
    ? html`<div class="archive-extra-lists" data-test="archive-extra-lists">
        <p>${t("product.archive_extra_lists")}</p>
        <ul>
          ${names.map((name) => html`<li>${name}</li>`)}
        </ul>
      </div>`
    : nothing;
}
