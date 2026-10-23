import { css } from "lit";

/** A readability warning, its fix button, and a "fixed from … · Undo" line. */
export const fixLineStyles = css`
  .warning {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    margin: var(--wt-space-3) 0 0;
    color: var(--wt-color-warning);
  }
  /* wt-icon's own host rule paints it in the text colour. */
  .warning > wt-icon {
    flex-shrink: 0;
    color: inherit;
  }
  .fixed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    margin: 0;
  }
  /* The "·" and Undo never part, and a "·" carried to the start of a line is pulled out past
     the clip edge, so Undo on a line of its own has no "·" (design: a wrapped link drops it).
     The clip margin is the focus ring's room. */
  .undo-line {
    margin: 0;
    overflow: clip;
    overflow-clip-margin: var(--wt-space-1);
    white-space: nowrap;
  }
  .undo-line > .fixed-text {
    padding-inline-end: var(--wt-space-4);
    white-space: normal;
  }
  .undo-line > .dot {
    display: inline-block;
    width: var(--wt-space-4);
    margin-inline-start: calc(-1 * var(--wt-space-4));
    text-align: center;
  }
  .undo-line > wt-button {
    vertical-align: middle;
  }
`;
