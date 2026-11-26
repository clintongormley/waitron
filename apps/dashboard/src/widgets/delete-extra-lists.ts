import { html, nothing } from "lit";
import type { ExtraList, Product } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { EditorVariant } from "./product-editor-model.js";

export function deleteExtraListWarning(
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
  return deleteExtraListWarningForIds(removed, lists);
}

export function stagedVariantDeleteWarning(
  saved: readonly EditorVariant[],
  draft: readonly EditorVariant[],
  lists: readonly Pick<ExtraList, "name" | "items">[],
) {
  const savedActiveIds = new Set(
    saved.filter((variant) => variant.active).map((variant) => variant.id),
  );
  if (savedActiveIds.size === 0) return nothing;
  const removed = new Set(
    draft.flatMap(({ id, active }) =>
      id !== undefined && !active && savedActiveIds.has(id) ? [id] : [],
    ),
  );
  const warning = deleteExtraListWarningForIds(removed, lists);
  return html`<div class="variant-delete-status" role="status">${warning}</div>`;
}

function deleteExtraListWarningForIds(
  removed: ReadonlySet<string>,
  lists: readonly Pick<ExtraList, "name" | "items">[],
) {
  if (removed.size === 0) return nothing;
  const names = [
    ...new Set(
      lists
        .filter((list) => list.items.some((item) => removed.has(item.productId)))
        .map((list) => list.name),
    ),
  ];
  return names.length
    ? html`<div class="delete-extra-lists" data-test="delete-extra-lists">
        <p>${t("product.delete_extra_lists")}</p>
        <ul>
          ${names.map((name) => html`<li>${name}</li>`)}
        </ul>
      </div>`
    : nothing;
}
