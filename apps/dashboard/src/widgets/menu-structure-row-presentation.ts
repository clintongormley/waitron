import { css, html } from "lit";
import { countOf } from "./count-text.js";

export const structureRowStyles = css`
  wt-data-table {
    --structure-media-size: calc(var(--wt-space-6) + var(--wt-space-1));
    --structure-grip-width: calc(var(--wt-space-6) - var(--wt-field-line-width-active));
    --structure-media-gap: var(--wt-space-3);
  }
  wt-data-table[narrow] {
    --tree-arrow-width: var(--wt-space-5);
    --structure-media-size: calc(var(--wt-space-6) - var(--wt-field-line-width-active));
    --structure-grip-width: calc(var(--wt-space-5) + var(--wt-field-line-width-active));
    --structure-media-gap: var(--wt-space-1);
    --structure-amount-width: calc(var(--wt-price-field-width) - var(--wt-space-5));
  }
  wt-data-table::part(toolbar-search) {
    flex-basis: 0;
  }
  wt-data-table::part(tree-cell) {
    align-items: center;
  }
  wt-data-table::part(structure-cell) {
    padding-block: calc(var(--wt-space-1) / 2);
    vertical-align: middle;
  }
  wt-data-table[narrow]::part(structure-cell) {
    padding-block: var(--wt-space-1);
  }
  wt-data-table::part(tree-toggle) {
    font-family: inherit;
  }
  wt-data-table[narrow]::part(tree-toggle) {
    inline-size: var(--tree-arrow-width);
    margin-inline-start: 0;
    padding-inline-start: 0;
  }
  wt-data-table::part(tree-heading),
  wt-data-table[narrow]::part(tree-heading) {
    margin-inline-start: calc(
      var(--tree-arrow-width) + var(--structure-media-size) + var(--structure-media-gap)
    );
  }
  wt-data-table::part(thumb-frame),
  wt-data-table::part(thumb-placeholder),
  wt-data-table::part(product-media),
  wt-data-table::part(swatch-button),
  wt-data-table::part(folder-frame) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: var(--structure-media-size);
    block-size: var(--structure-media-size);
    flex-shrink: 0;
  }
  wt-data-table[narrow]::part(folder-frame),
  wt-data-table[narrow]::part(swatch-box),
  wt-data-table[narrow]::part(swatch-button),
  wt-data-table[narrow]::part(thumb-frame),
  wt-data-table[narrow]::part(thumb-placeholder),
  wt-data-table[narrow]::part(product-media) {
    display: inline-flex;
  }
  wt-data-table::part(product-media),
  wt-data-table::part(folder-frame),
  wt-data-table[narrow]::part(product-media),
  wt-data-table[narrow]::part(folder-frame) {
    margin-inline-end: var(--structure-media-gap);
  }
  wt-data-table::part(product-cell) {
    display: inline-flex;
    align-items: center;
  }
  wt-data-table::part(media-placeholder-icon) {
    color: var(--wt-color-text);
  }
  wt-data-table[data-selecting][narrow]::part(drag-grip),
  wt-data-table[data-selecting][narrow]::part(grip-space),
  wt-data-table::part(narrow-usual-price),
  wt-data-table[narrow]::part(usual-price) {
    display: none;
  }
  wt-data-table[narrow]::part(narrow-usual-price) {
    display: inline;
  }
  wt-data-table::part(section-name) {
    font-weight: var(--wt-font-weight-bold);
  }
  wt-data-table::part(read-only) {
    color: var(--wt-color-text-muted);
  }
  wt-data-table::part(structure-unavailable),
  wt-data-table::part(structure-clash) {
    color: var(--wt-color-danger);
  }
  wt-data-table::part(structure-unavailable) {
    align-self: start;
    font-size: var(--wt-font-size-sm);
    padding-inline: var(--wt-space-1);
    border: 1px solid currentColor;
    border-radius: var(--wt-radius-sm);
    max-inline-size: 100%;
    box-sizing: border-box;
  }
  wt-data-table::part(structure-price) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    justify-items: end;
    gap: var(--wt-space-1);
  }
  wt-data-table[narrow]::part(structure-price) {
    grid-template-columns: auto;
  }
  wt-data-table::part(usual-price) {
    grid-column: 1;
    grid-row: 1;
  }
  wt-data-table::part(structure-price-field) {
    grid-column: -2;
  }
  wt-data-table[narrow]::part(structure-price-field) {
    --wt-price-field-width: var(--structure-amount-width);
  }
  wt-data-table::part(structure-clash) {
    grid-column: 1 / -1;
    white-space: normal;
  }
`;

export function sectionCountNote(
  key: "product.variant_count" | "folders.product_count",
  count: number,
  unavailable: number,
) {
  const note = countOf(key, count);
  return html`<span part="note"
    >${note}${unavailable ? " · " + countOf("product.unavailable_count", unavailable) : ""}</span
  >`;
}
