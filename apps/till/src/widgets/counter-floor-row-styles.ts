import { css } from "lit";

export const counterFloorRowStyles = css`
  :host([floor]) .order {
    gap: 0;
    padding: 0;
    background: var(--wt-color-surface);
    min-block-size: calc(var(--wt-tap-min) + var(--wt-space-4) + var(--wt-space-1) / 2);
  }

  :host([floor]) .summary {
    flex: 1 1 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--wt-space-1) var(--wt-space-3);
    align-items: center;
    min-height: calc(var(--wt-tap-min) + var(--wt-space-4));
    padding: var(--wt-space-2) var(--wt-space-4);
    text-align: start;
    overflow-wrap: anywhere;
  }

  :host([floor]) .number {
    font-size: calc((var(--wt-font-size-md) + var(--wt-font-size-lg)) / 2);
  }

  :host([floor]) .state {
    color: var(--wt-color-text-muted);
    font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
    font-weight: var(--wt-font-weight-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :host([ready]) .elapsed {
    margin-inline-start: var(--wt-space-2);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-md);
    white-space: nowrap;
  }

  :host([ready]) .state {
    font-size: var(--wt-font-size-md);
  }

  :host([ready]) .summary {
    grid-template-columns: minmax(0, 1fr);
  }

  :host([floor]:not([ready])) .meta {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
  }

  :host([floor]) .controls {
    padding: var(--wt-space-2) var(--wt-space-4);
  }

  :host([ready]) .order {
    border-inline-start: calc(var(--wt-space-3) / 2) solid var(--wt-color-success);
    min-height: calc(var(--wt-space-4) * 4);
  }
`;
