import { css } from "lit";

export const baseStyles = css`
  :host,
  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }

  :host {
    font-family: var(--wt-font-family);
    font-size: var(--wt-font-size-md);
    color: var(--wt-color-text);
  }

  :host([hidden]) {
    display: none;
  }

  :focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;

/**
 * The disabled-state treatment shared by every primitive that dims its own interactive element
 * on `:disabled`/`[disabled]` — wt-button's `button:disabled` and wt-input's `input:disabled`
 * both apply this verbatim. Interpolate it into the selector body, e.g.
 * `button:disabled { ${disabledStyles} }`, rather than re-spelling the declarations (and the
 * --wt-opacity-disabled token they read) in each component.
 *
 * wt-switch does NOT use this fragment: its opacity and cursor live on two different selectors
 * (`:host([disabled])` and `input:disabled`), because the native `<input>` is an invisible
 * (`opacity: 0`) hit-target layer, not the visible control — applying this fragment's opacity
 * declaration there would make that invisible input visible whenever disabled. It still reads
 * `var(--wt-opacity-disabled)` directly for its half of the treatment.
 */
export const disabledStyles = css`
  opacity: var(--wt-opacity-disabled);
  cursor: not-allowed;
`;

/**
 * The unplaced-tables TRAY shared by the two floor-plan screens (`till-floor-screen`,
 * `dashboard-floor-screen`), whose `.tray` / `.tray-label` / `.tray-item` rules were byte-identical.
 * Composed after `baseStyles` in each screen's `static styles`; each screen keeps its own app-specific
 * CSS (the map/plano wrappers, cards, panels) beside it. The `.tray-item` is the tappable button; the
 * shared `<wt-table-token>` nested inside it carries the visual.
 */
export const floorTrayStyles = css`
  .tray {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: var(--wt-space-2);
    padding: var(--wt-space-2);
    border: 1px dashed var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }

  .tray-label {
    width: 100%;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }

  .tray-item {
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
`;

/**
 * The standard token-styled native `<select>`, shared by every screen/widget that falls back to a
 * plain `<select>` for want of a `wt-select` primitive (the dashboard's roster/role/floor/… pickers
 * and the setup wizard's venue pickers). Composed after `baseStyles` in each consumer's
 * `static styles`; a consumer needing more (e.g. a `min-width`) layers its own `select { … }` rule
 * after this. This is the FORM `<select>` (`width: 100%`), deliberately distinct from
 * `apps/till`'s touch tap-target select (`min-height`/larger padding, no `width`) which keeps its
 * own local copy.
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
