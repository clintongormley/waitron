import { css } from "lit";

/**
 * Shared token styling for the till's token-styled native `<select>`s (the tab-order screen's per-line
 * course picker and the schedule screen's colleague/swap pickers) — there is no `wt-select` primitive,
 * so both fall back to a plain `<select>` styled with the same tokens. A consumer that needs more (the
 * schedule screen adds `min-width`) layers its own `select { … }` rule after this in its `styles` array.
 *
 * This DELIBERATELY differs from `@waitron/ui`'s shared `selectStyles` and keeps its own local copy: the
 * till is a touch surface, so its select is a tap-target (`min-height: var(--wt-tap-min)` + roomier
 * padding, no `width: 100%`), whereas the shared form select fills its container. Do not "dedupe" this
 * into the `@waitron/ui` export — the two are different by design.
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
