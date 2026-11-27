import { css } from "lit";

/** Browsing and the order: one above the other under a Menu / Order switch, or side by side. */
export const orderLayoutStyles = css`
  .ordering {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-4);
  }

  .ordering.side-by-side {
    flex-direction: row;
    align-items: flex-start;
  }

  .browsing {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-3);
    min-width: 0;
  }

  .side-by-side .browsing {
    flex: 3 1 0;
  }

  .draft-pane {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-3);
    min-width: 0;
  }

  .side-by-side .draft-pane {
    flex: 2 1 0;
    padding-inline-start: var(--wt-space-4);
    border-inline-start: var(--wt-space-1) solid var(--wt-color-border);
    background: var(--wt-color-surface);
  }

  /* Sent rows sit on the page colour (spec §14.4), out to the column's edge, while the new
       dishes keep the column's surface. */
  .side-by-side .draft-pane till-sent-orders {
    margin-inline-start: calc(-1 * var(--wt-space-4));
    padding-inline-start: var(--wt-space-4);
    background: var(--wt-color-bg);
  }

  .browsing[hidden],
  .draft-pane[hidden] {
    display: none;
  }
`;
