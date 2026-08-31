import { css } from "lit";

/**
 * The shared `.option` styling for the till's segmented controls — a native `<button>` option with a
 * `aria-pressed="true"` active state. Used byte-for-byte by both `till-menu-switcher` and
 * `till-diet-filter` (both render `role="group"` of native option buttons above the product grid), so
 * the rules live here once. Each widget keeps its own `:host` and inner-container (`.switcher` /
 * `.filter`) rules — those differ per widget — and appends this block.
 */
export const segmentedOptionStyles = css`
  .option {
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-4);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    font: inherit;
    font-weight: var(--wt-font-weight-bold);
    cursor: pointer;
  }

  .option:hover {
    background: var(--wt-color-surface-raised);
  }

  .option[aria-pressed="true"] {
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
    border-color: var(--wt-color-primary);
  }
`;
