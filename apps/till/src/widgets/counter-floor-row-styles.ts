import { css } from "lit";

export const counterFloorRowStyles = css`
  :host([floor]) .order {
    gap: 0;
    padding: 0;
    background: var(--wt-color-surface);
  }

  :host([floor]) .summary {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--wt-space-1) var(--wt-space-3);
    align-items: center;
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-3) var(--wt-space-4);
    text-align: start;
    overflow-wrap: anywhere;
  }

  :host([floor]) .state {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
  }

  :host([floor]:not([ready])) .meta {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  :host([floor]) .controls {
    padding: var(--wt-space-2) var(--wt-space-4);
  }

  :host([ready]) .order {
    border-inline-start: calc(var(--wt-space-3) / 2) solid var(--wt-color-success);
    min-height: calc(var(--wt-space-4) * 4);
  }
`;
