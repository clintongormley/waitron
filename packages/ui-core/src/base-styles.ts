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
