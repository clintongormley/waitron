import { css } from "lit";

/**
 * Shared token styling for the two token-styled native `<select>`s in the dashboard (the login
 * screen's roster picker and the create-person form's role picker) — there is no `wt-select`
 * primitive, so both components fall back to a plain `<select>` styled with the same tokens.
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
