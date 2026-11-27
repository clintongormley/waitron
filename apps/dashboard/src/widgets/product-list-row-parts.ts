import { css, html, nothing } from "lit";
import type { Product } from "../api/client.js";
import { t } from "../i18n/t.js";
import { countOf } from "./count-text.js";

export const productRowStyles = css`
  wt-data-table::part(thumb-frame),
  wt-data-table::part(thumb-placeholder),
  wt-data-table::part(color-swatch) {
    inline-size: var(--products-media-size);
    block-size: var(--products-media-size);
  }
  wt-data-table::part(product-media) {
    align-items: center;
    justify-content: center;
  }
  wt-data-table[wrap-to-fit]::part(tree-toggle) {
    flex-shrink: 0;
  }
  wt-data-table::part(variant-cell) {
    padding-inline-start: var(--wt-space-4);
  }
  wt-data-table[narrow]::part(variant-cell) {
    padding-inline-start: var(--wt-space-2);
  }
  wt-data-table:not([narrow])::part(name-stack) {
    flex-flow: row wrap;
    align-items: baseline;
    column-gap: var(--wt-space-2);
  }
  wt-data-table::part(row-labels) {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--wt-space-2);
    align-items: baseline;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(unavailable-label) {
    border-color: var(--wt-color-danger);
    color: var(--wt-color-danger);
    margin-inline-start: var(--wt-space-1);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(product-name),
  wt-data-table::part(variant-name) {
    font-weight: var(--wt-font-weight-normal);
  }
  wt-data-table::part(unavailable-count) {
    color: var(--wt-color-danger);
  }
  wt-data-table[narrow]::part(unavailable-label) {
    display: inline;
    border: 0;
    padding: 0;
    margin-inline-start: 0;
  }
  wt-data-table::part(phone-row-labels) {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(inherited-allergens),
  wt-data-table::part(inherited-price) {
    color: var(--wt-color-text-muted);
  }
  wt-data-table {
    --products-unit-width: calc(var(--wt-tap-min) * 2);
  }
  wt-data-table[data-compact-products] {
    --products-unit-width: var(--wt-tap-min);
  }
  wt-data-table::part(column-available) {
    inline-size: 0;
  }
  wt-data-table:not([narrow])::part(column-price) {
    inline-size: calc(var(--wt-tap-min) * 4);
  }
  wt-data-table:not([narrow])::part(column-sort-price),
  wt-data-table:not([narrow])::part(price-layout) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--products-unit-width);
    column-gap: var(--wt-space-1);
    align-items: baseline;
    inline-size: 100%;
    text-align: end;
  }
  wt-data-table::part(column-heading-price) {
    justify-self: end;
  }
  wt-data-table[narrow]::part(column-price) {
    inline-size: calc(var(--wt-tap-min) * 2 + var(--wt-space-2));
  }
  wt-data-table[narrow]::part(price-layout) {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    justify-content: end;
    column-gap: var(--wt-space-1);
  }
  wt-data-table[narrow]::part(vat-note) {
    flex-basis: 100%;
  }
  wt-data-table::part(price-amount) {
    white-space: nowrap;
  }
  wt-data-table[narrow]::part(price-amount) {
    white-space: normal;
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

export function productDetailText(text: string) {
  return text ? html`<span part="product-detail product-detail-text">${text}</span>` : nothing;
}

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

export function unavailableCount(count: number) {
  return count
    ? html`<span part="unavailable-count"> · ${countOf("product.unavailable_count", count)}</span>`
    : nothing;
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
            >${countOf("product.variant_count", variants.length)}${unavailableCount(unavailable)}</span
          >`
        : nothing
    }
    ${product.modifiers.length ? html`<span>${t("editor.modifiers")}</span>` : nothing}
    ${ordering ? html`<span>${ordering}</span>` : nothing}
  </span>`;
}
