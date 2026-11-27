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
    /* A variant follows its parent's full-width toggle with a small indent. */
    padding-inline-start: calc(
      var(--wt-tap-min) - var(--products-toggle-overhang) - var(--tree-arrow-width) +
        var(--wt-space-2)
    );
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
  wt-data-table[data-phone]::part(unavailable-total) {
    display: inline-block;
    max-inline-size: 100%;
  }
  wt-data-table[data-phone]::part(availability-switch) {
    --wt-switch-track-offset: calc(var(--wt-tap-min) - var(--wt-space-6));
  }
  wt-data-table[data-phone]::part(column-actions)::before,
  wt-data-table[data-phone]::part(products-cell)::before {
    inset-inline-start: calc(var(--wt-space-2) - var(--wt-table-cell-padding-inline));
  }
  wt-data-table[data-phone]::part(unavailable-label) {
    display: inline;
    border: 0;
    padding: 0;
    margin-inline-start: 0;
  }
  wt-data-table[data-phone][data-list]::part(unavailable-label) {
    display: inline-block;
    max-inline-size: 100%;
  }
  wt-data-table::part(phone-row-labels) {
    /* This line can use the gap between Name and Price. */
    margin-inline-end: calc(-2 * var(--wt-table-cell-padding-inline));
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--wt-space-2);
    overflow: hidden;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(phone-category-status) {
    position: relative;
    min-inline-size: 0;
  }
  wt-data-table::part(phone-category-status)::before {
    /* Wrapping puts the label at the line start, outside which its separator is clipped. */
    content: "·" / "";
    position: absolute;
    inset-inline-end: calc(100% + var(--wt-space-1) / 2);
  }
  wt-data-table::part(inherited-allergens),
  wt-data-table::part(inherited-price) {
    color: var(--wt-color-text-muted);
  }
  wt-data-table {
    --products-unit-width: calc(var(--wt-tap-min) * 2);
  }
  wt-data-table[data-compact-products] {
    --products-unit-width: calc(var(--wt-tap-min) + var(--wt-space-2));
  }
  wt-data-table::part(column-available) {
    inline-size: 0;
  }
  wt-data-table::part(column-sort-available) {
    min-block-size: var(--wt-space-5);
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
  }
  wt-data-table::part(column-heading-price),
  wt-data-table::part(price-layout) {
    text-align: end;
  }
  wt-data-table[narrow]::part(column-price) {
    inline-size: calc(var(--wt-tap-min) * 2 + var(--wt-space-1));
  }
  wt-data-table[narrow][data-phone]:not([data-list])::part(column-price) {
    inline-size: calc(var(--wt-tap-min) * 2 - var(--wt-space-1));
  }
  wt-data-table[narrow][data-list]::part(column-price) {
    inline-size: calc(var(--wt-tap-min) + var(--wt-space-6) + var(--wt-space-1) / 2);
  }
  wt-data-table[narrow]::part(column-sort-price) {
    flex-direction: row-reverse;
    align-items: baseline;
  }
  wt-data-table[narrow]::part(price-layout) {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    justify-content: end;
    column-gap: calc(var(--wt-space-1) / 2);
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
    ? html`<span part="unavailable-count"
        >${" · "}<span part="unavailable-total"
          >${countOf("product.unavailable_count", count)}</span
        ></span
      >`
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
