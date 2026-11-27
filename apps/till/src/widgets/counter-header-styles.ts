import { css } from "lit";

export const counterStripItems = ".till-strip > .tabs, .counter-shortcuts > *";

export const counterHeaderStyles = css`
  .till-strip {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    align-items: center;
    gap: var(--wt-space-2);
  }

  .till-strip > .tabs,
  .counter-shortcuts > * {
    flex: none;
  }

  .head.phone .till-strip .tabs {
    flex: none;
  }

  /* Keep an open zone picker mounted when rotation changes which row scrolls. */
  .counter-navigation,
  .counter-shortcuts:not(.till-strip) {
    display: contents;
  }

  [data-counter-zones]::part(trigger) {
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-3);
    font-weight: var(--wt-font-weight-bold);
  }

  [data-counter-zones][data-active]::part(trigger) {
    background: var(--wt-color-surface-raised);
    border-color: var(--wt-color-border);
  }

  .head[data-narrow-counter] {
    flex-wrap: wrap;
  }

  .head[data-narrow-counter] .tabs {
    flex: 0 0 100%;
    overflow: visible;
    order: -1;
  }

  [data-narrow-counter] [data-counter-zones] {
    min-inline-size: 0;
  }

  [data-narrow-counter] [data-counter-zones]::part(trigger) {
    max-inline-size: 100%;
  }

  [data-narrow-counter] [data-counter-zones] > [slot="trigger"] {
    display: flex;
    gap: var(--wt-space-1);
    padding: 0;
    white-space: nowrap;
  }

  [data-narrow-counter] [data-counter-zones] > [slot="trigger"] > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
