import { css, html, nothing } from "lit";

// Cells belong to wt-data-table's shadow root; only parts cross that boundary.
export const menuTreeStyles = css`
  wt-data-table::part(folder-cell) {
    display: flex;
    align-items: center;
  }
  wt-data-table::part(folder-frame) {
    display: inline-flex;
    flex: none;
    justify-content: center;
    width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    align-items: center;
    margin-inline-end: var(--wt-space-3);
  }
  wt-data-table::part(tree-heading) {
    margin-inline-start: calc(var(--tree-arrow-width) + var(--wt-tap-min) + var(--wt-space-3));
  }
  wt-data-table::part(product-cell) {
    display: block;
  }
  wt-data-table[narrow]::part(tree-heading) {
    margin-inline-start: var(--tree-arrow-width);
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
  wt-data-table[narrow]::part(swatch-button),
  wt-data-table[narrow]::part(swatch-box),
  wt-data-table[narrow]::part(folder-frame),
  wt-data-table[narrow]::part(thumb-frame),
  wt-data-table[narrow]::part(thumb-placeholder) {
    display: none;
  }
  wt-data-table::part(thumbnail) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  wt-data-table::part(name-stack) {
    display: inline-flex;
    flex-direction: column;
  }
  /* A folder's flex row keeps the name on its baseline beside the media slot. */
  wt-data-table::part(folder-stack) {
    align-self: baseline;
    justify-content: center;
    min-height: var(--wt-tap-min);
  }
`;

export const folderFrame = (content: unknown = nothing) =>
  html`<span part="folder-frame">${content}</span>`;

export function menuTreeCell(kind: "section" | "product", media: unknown, stack: unknown) {
  return kind === "section"
    ? html`<span part="folder-cell">${folderFrame(media)}${stack}</span>`
    : html`<span part="product-cell">${media}${stack}</span>`;
}
