import { css } from "lit";

/** A floor plan's `.table`, round when `data-shape="round"`, and the `.fixed-marker` inside it. */
export const floorPlanTableStyles = css`
  .table {
    position: absolute;
    overflow: hidden;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface-lifted);
  }

  .table[data-shape="round"] {
    border-radius: 50%;
  }

  .fixed-marker {
    position: absolute;
    top: 0;
    right: 0;
    width: var(--wt-space-2);
    height: var(--wt-space-2);
    border-bottom-left-radius: var(--wt-radius-sm);
    background: var(--wt-color-text-muted);
  }

  /* A circle clips the corner, so the mark sits where the circle still covers it. */
  .table[data-shape="round"] .fixed-marker {
    top: 15%;
    right: 15%;
    border-radius: 50%;
  }
`;
