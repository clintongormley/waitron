import { css } from "lit";

export const sidebarHeadingStyles = css`
  .nav-group {
    display: flex;
    align-items: flex-start;
    width: 100%;
    min-height: var(--wt-tap-min);
    margin: var(--wt-space-2) 0 0;
    padding: var(--wt-space-3);
    border: none;
    border-inline-start: 3px solid transparent;
    background: transparent;
    font: inherit;
    line-height: var(--wt-font-size-lg);
    text-align: start;
    cursor: pointer;
  }

  @media (pointer: fine) {
    .nav-group {
      min-height: var(--wt-space-6);
      padding-block: var(--wt-space-2) 0;
    }
  }

  .nav-group-pages {
    padding-block-end: var(--wt-space-1);
  }

  /* After .nav-group's own rule, whose font shorthand would reset the size and weight. */
  .nav-group,
  .strip-panel-label {
    color: var(--wt-color-text);
    font-size: var(--wt-font-size-md);
    font-weight: var(--wt-font-weight-bold);
  }

  button.nav-group:hover {
    background: var(--wt-color-surface);
  }

  div.nav-group {
    cursor: default;
  }

  .nav-group-label {
    flex: 1;
    min-width: 0;
  }

  .nav-group :is(.chevron-space, .chevron) {
    flex-shrink: 0;
    width: var(--wt-space-4);
    margin-inline-start: var(--wt-space-1);
  }

  .nav-group .chevron {
    height: var(--wt-space-4);
    margin-block-start: calc((var(--wt-font-size-lg) - var(--wt-space-4)) / 2);
    color: var(--wt-color-text-muted);
    transition: transform 150ms ease;
  }

  .nav-group[aria-expanded="true"] .chevron {
    transform: rotate(180deg);
  }
`;
