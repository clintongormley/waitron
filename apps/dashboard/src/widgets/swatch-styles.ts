import { css } from "lit";

/** A host whose tree rows draw colour swatches adds these: the rows render inside wt-data-table's
 * shadow root, so ::part is the only way in. */
export const swatchPartStyles = css`
  wt-data-table::part(swatch-button),
  wt-data-table::part(swatch-box) {
    display: inline-flex;
    flex: none;
    vertical-align: middle;
    align-items: center;
    justify-content: center;
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
    padding: 0;
    border: 0;
    background: transparent;
  }
  wt-data-table::part(swatch-button) {
    cursor: pointer;
  }
  wt-data-table::part(swatch-button):disabled {
    cursor: default;
    opacity: var(--wt-opacity-disabled);
  }
  wt-data-table::part(color-swatch) {
    width: var(--wt-space-5);
    height: var(--wt-space-5);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
  }
`;
