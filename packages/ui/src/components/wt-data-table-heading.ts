import { css } from "lit";

export const tableHeadingStyles = css`
  thead {
    position: sticky;
    inset-block-start: 0;
    z-index: 3;
    background: var(--wt-color-surface);
  }

  thead th {
    border-block-end: 0;
    position: relative;
    background: var(--wt-color-surface);
  }

  thead th::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    border-block-end: 1px solid var(--wt-color-border);
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-1);
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  .sort:has(.visually-hidden) {
    min-inline-size: var(--wt-space-5);
    min-block-size: var(--wt-space-5);
  }

  .sort:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }

  .head-label {
    position: relative;
    display: inline-block;
  }

  .indicator {
    width: var(--wt-font-size-md);
    text-align: center;
  }
`;
