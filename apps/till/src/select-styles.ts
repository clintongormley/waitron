import { css } from "lit";

/**
 * Deliberately not `@waitron/ui`'s `selectStyles`: the till's select is a touch target and does not
 * fill its container. Do not merge the two.
 */
export const selectStyles = css`
  select {
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font: inherit;
  }
`;
