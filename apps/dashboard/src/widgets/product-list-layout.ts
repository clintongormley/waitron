import { css } from "lit";

export const productListLayoutStyles = css`
  wt-data-table[data-compact-products] {
    --wt-table-cell-padding-inline: var(--wt-space-1);
  }
  wt-data-table {
    --tree-arrow-width: calc(var(--wt-tap-min) - var(--wt-space-2));
  }
  wt-data-table[narrow] {
    --tree-arrow-width: calc(var(--wt-tap-min) - var(--wt-space-2));
    --wt-table-cell-padding-inline: 0px;
  }
  wt-data-table[narrow][data-list] {
    --tree-arrow-width: var(--wt-space-4);
    --wt-table-cell-padding-inline: calc(var(--wt-space-1) / 2);
  }
  wt-data-table[narrow]::part(tree-cell) {
    --products-tree-inset: calc(min(var(--tree-depth, 0), 4) * var(--wt-space-1));
    /* The toggle can use leading space up to the cell edge without reaching the checkbox. */
    --products-toggle-overhang: min(
      calc(var(--wt-tap-min) - var(--tree-arrow-width)),
      calc(var(--products-tree-inset) + var(--wt-table-cell-padding-inline))
    );
    padding-inline-start: var(--products-tree-inset);
  }
  wt-data-table[data-phone]::part(toolbar-search) {
    flex-basis: calc(var(--wt-tap-min) * 5);
  }
  /* Cell templates are rendered in wt-data-table's shadow root, so ::part is the one boundary
     crossing used for their presentation. */
  wt-data-table::part(folder-frame) {
    display: inline-flex;
    flex: none;
    vertical-align: middle;
    justify-content: center;
    width: var(--wt-tap-min);
    margin-inline-end: var(--wt-space-3);
  }
  wt-data-table::part(naming-frame) {
    display: inline-block;
    align-self: baseline;
  }
  wt-data-table::part(tree-heading) {
    margin-inline-start: calc(var(--tree-arrow-width) + var(--wt-tap-min) + var(--wt-space-3));
  }
  wt-data-table::part(drag-grip) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    padding: 0;
    border: 0;
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    touch-action: none;
    user-select: none;
    cursor: var(--reorder-drag-cursor, grab);
  }
  wt-data-table::part(grip-space) {
    display: inline-block;
    flex: none;
    vertical-align: middle;
    width: var(--wt-tap-min);
  }
  wt-data-table::part(thumb-frame),
  wt-data-table::part(thumb-placeholder) {
    box-sizing: border-box;
    display: inline-block;
    vertical-align: middle;
    margin-inline-end: var(--wt-space-3);
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    overflow: hidden;
    background: var(--wt-color-surface);
  }
  wt-data-table::part(thumbnail) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  wt-data-table::part(badge) {
    display: inline-flex;
    padding: 0 var(--wt-space-2);
    border: 1px solid var(--wt-color-text-muted);
    border-radius: var(--wt-radius-sm);
  }
  wt-data-table::part(count),
  wt-data-table::part(unrouted-folder) {
    margin-inline-start: var(--wt-space-2);
  }
  wt-data-table::part(unrouted-folder) {
    color: var(--wt-color-danger);
    font-weight: var(--wt-font-weight-bold);
  }
  wt-data-table::part(context) {
    color: var(--wt-color-text-muted);
  }
  wt-data-table::part(count),
  wt-data-table::part(variant-count) {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  wt-data-table::part(folder-name),
  wt-data-table::part(name-stack),
  wt-data-table::part(variant-name) {
    display: inline-flex;
    flex-direction: column;
  }
  wt-data-table::part(search-name-line) {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--wt-space-2);
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }
  wt-data-table::part(search-path) {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    min-inline-size: 0;
  }
  wt-data-table::part(tree-toggle) {
    font-family: inherit;
    margin-inline-start: calc(var(--tree-arrow-width) - var(--wt-tap-min));
    padding-inline-start: calc(var(--wt-tap-min) - var(--tree-arrow-width));
  }
  wt-data-table[narrow]::part(variant-toggle) {
    margin-inline-start: calc(-1 * var(--products-toggle-overhang));
    padding-inline-start: var(--products-toggle-overhang);
  }
  wt-data-table::part(variant-toggle) {
    font-family: revert;
    padding-inline-end: var(--wt-space-1);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    text-align: end;
  }
  wt-data-table::part(vat-note) {
    display: block;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    white-space: nowrap;
  }
  wt-data-table::part(folder-name),
  wt-data-table::part(name-stack),
  wt-data-table::part(variant-name) {
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }
  wt-data-table::part(name-box) {
    flex: 1 1 calc(var(--wt-tap-min) * 4);
    min-width: 0;
    max-inline-size: max(var(--wt-tap-min), var(--name-box-room));
  }
  wt-data-table::part(name-after) {
    display: contents;
  }
`;

export const fullRowProductsMediaStyles = css`
  wt-data-table {
    --products-media-size: calc(var(--wt-space-6) + var(--wt-space-1));
    /* Centre one line of text in the same band as the row's tap targets. */
    --products-first-line-inset: calc((var(--wt-tap-min) - 1lh) / 2);
  }
  wt-data-table[narrow] {
    --products-media-size: calc(var(--wt-space-6) - var(--wt-space-1) / 2);
  }
  wt-data-table::part(tree-row) {
    position: relative;
  }
  wt-data-table[data-availability-saving]::part(tree-row) {
    /* The pending switch can move its row as the save finishes. */
    overflow-anchor: none;
  }
  wt-data-table::part(tree-indent) {
    flex: none;
  }
  wt-data-table::part(products-cell) {
    vertical-align: top;
  }
  wt-data-table::part(tree-cell) {
    align-items: start;
    vertical-align: top;
    max-inline-size: 100%;
    min-inline-size: 0;
    box-sizing: border-box;
  }
  wt-data-table::part(product-cell),
  wt-data-table::part(variant-cell),
  wt-data-table::part(folder-cell) {
    display: flex;
    align-items: start;
    min-inline-size: 0;
  }
  wt-data-table::part(naming) {
    max-inline-size: var(--name-room);
    align-items: center;
  }
  wt-data-table::part(name-stack),
  wt-data-table::part(variant-name),
  wt-data-table::part(folder-name),
  wt-data-table::part(price-layout) {
    padding-block-start: var(--products-first-line-inset);
  }
  wt-data-table::part(price-layout),
  wt-data-table::part(availability-switch),
  wt-data-table::part(product-detail) {
    vertical-align: top;
  }
  wt-data-table::part(product-detail) {
    margin-block-start: var(--products-first-line-inset);
  }
  wt-data-table::part(product-detail-text) {
    display: inline-block;
  }
  wt-data-table::part(row-checkbox) {
    margin-block: calc((var(--wt-tap-min) - var(--wt-space-4)) / 2);
  }
  wt-data-table[narrow]::part(naming) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    inline-size: var(--name-room);
    align-items: start;
  }
  wt-data-table[narrow]::part(name-after) {
    display: block;
    grid-column: 2;
    grid-row: 1;
    overflow-wrap: anywhere;
  }
  wt-data-table[narrow]::part(naming-frame) {
    grid-column: 1;
    grid-row: 1 / span 2;
    align-self: center;
  }
  wt-data-table[narrow]::part(name-box) {
    grid-column: 2;
    grid-row: 2;
    position: relative;
    z-index: 1;
    inline-size: max(var(--wt-tap-min), var(--name-box-room));
    min-inline-size: var(--wt-tap-min);
  }
  wt-data-table[narrow]:not([data-list])::part(row-controls) {
    flex-direction: column;
    align-items: center;
    gap: 0;
  }

  wt-data-table::part(products-media-slot) {
    flex: none;
    display: inline-block;
    vertical-align: middle;
    margin-inline-end: var(--wt-space-3);
    inline-size: var(--wt-tap-min);
    min-block-size: var(--wt-tap-min);
  }
  /* The slot reserves the inline space. The row supplies the target's block size. */
  wt-data-table::part(product-media),
  wt-data-table::part(swatch-button) {
    position: absolute;
    inset-block: 0;
    block-size: auto;
    margin-inline-end: 0;
    align-items: start;
    padding-block-start: calc(
      var(--wt-table-cell-padding-block) + (var(--wt-tap-min) - var(--products-media-size)) / 2
    );
  }
  wt-data-table::part(product-media):focus-visible,
  wt-data-table::part(swatch-button):focus-visible {
    outline-offset: calc(-1 * var(--wt-space-1));
  }
  wt-data-table::part(folder-frame) {
    min-block-size: var(--wt-tap-min);
  }
  wt-data-table[narrow]::part(folder-frame),
  wt-data-table[narrow]::part(products-media-slot) {
    margin-inline-end: calc(var(--wt-space-1) / 2);
  }
  wt-data-table[narrow]::part(tree-heading) {
    margin-inline-start: min(
      calc(var(--tree-arrow-width) + var(--wt-tap-min) + var(--wt-space-1) / 2),
      max(0px, calc(100% - var(--wt-tap-min) * 1.5))
    );
  }
  wt-data-table[narrow]::part(product-media) {
    display: inline-flex;
  }
  wt-data-table[narrow]::part(count) {
    display: table;
    margin-inline-start: 0;
  }
  wt-data-table::part(phone-category) {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    padding-block-start: 0;
  }
  wt-data-table[data-compact-products]::part(price-amount) {
    white-space: normal;
  }
  wt-data-table[data-compact-products]::part(vat-note) {
    white-space: normal;
    overflow-wrap: anywhere;
  }
`;
