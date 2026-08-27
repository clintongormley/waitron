import { css } from "lit";

/**
 * Shared token styling for the setup wizard's token-styled native `<select>`s (the venue screen's
 * fiscal-territory and time-zone pickers) — there is no `wt-select` primitive, so a screen falls back
 * to a plain `<select>` styled with the same `--wt-*` tokens. Mirrors `apps/dashboard/src/select-styles.ts`.
 */
export const selectStyles = css`
  select {
    font: inherit;
    padding: var(--wt-space-2);
    border-radius: var(--wt-radius-md);
    border: 1px solid var(--wt-color-border);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    width: 100%;
  }
`;
