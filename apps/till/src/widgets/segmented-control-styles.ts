import { css } from "lit";

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
