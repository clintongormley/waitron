import { css, html, nothing } from "lit";
import type { Product } from "../api/client.js";
import { t } from "../i18n/t.js";
import { countOf } from "./count-text.js";

export const productRowStyles = css`
  wt-data-table::part(thumb-frame),
  wt-data-table::part(thumb-placeholder),
  wt-data-table::part(color-swatch) {
    inline-size: calc(var(--wt-space-6) + var(--wt-space-1));
    block-size: calc(var(--wt-space-6) + var(--wt-space-1));
  }
  wt-data-table::part(product-media) {
    align-items: center;
    justify-content: center;
  }
  wt-data-table::part(variant-cell) {
    padding-inline-start: var(--wt-space-4);
  }
  wt-data-table[narrow]::part(variant-cell) {
    padding-inline-start: var(--wt-space-2);
  }
  wt-data-table::part(row-labels) {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--wt-space-2);
    align-items: baseline;
    align-self: flex-start;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(unavailable-label) {
    border-color: var(--wt-color-danger);
    color: var(--wt-color-danger);
    margin-inline-start: var(--wt-space-1);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(inherited-allergens),
  wt-data-table::part(inherited-price) {
    color: var(--wt-color-text-muted);
  }
  wt-data-table::part(price-layout) {
    display: inline-grid;
    grid-template-columns: auto var(--wt-tap-min);
    column-gap: var(--wt-space-1);
    align-items: baseline;
    vertical-align: baseline;
  }
  wt-data-table::part(price-amount) {
    white-space: nowrap;
  }
  wt-data-table::part(price-unit) {
    text-align: start;
    overflow-wrap: anywhere;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(vat-note) {
    grid-column: 1 / -1;
  }
`;

export function unavailableLabel(available: boolean) {
  return available
    ? nothing
    : html`<span
        part="badge unavailable-label"
        data-test="availability-badge"
        data-state="unavailable"
        >${t("product.unavailable_badge")}</span
      >`;
}

export function productRowLabels(product: Product) {
  const variants = product.variants.filter(({ active }) => active);
  const unavailable = variants.filter(({ available }) => !available).length;
  const ordering =
    product.ordering === "staff_only"
      ? t("product.ordering_staff_only")
      : product.ordering === "not_sold_separately"
        ? t("product.not_sold_separately")
        : "";
  if (!variants.length && !product.modifiers.length && !ordering) return nothing;
  return html`<span part="row-labels">
    ${
      variants.length
        ? html`<span part="variant-count" data-test="variant-count"
            >${countOf("product.variant_count", variants.length)}${
              unavailable ? ` · ${countOf("product.unavailable_count", unavailable)}` : ""
            }</span
          >`
        : nothing
    }
    ${product.modifiers.length ? html`<span>${t("editor.modifiers")}</span>` : nothing}
    ${ordering ? html`<span>${ordering}</span>` : nothing}
  </span>`;
}
