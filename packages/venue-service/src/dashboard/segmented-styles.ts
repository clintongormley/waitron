import { css } from "lit";

/** A row of radio buttons drawn as one joined switch: `.segmented > label > input + span`. */
export const segmentedStyles = css`
  .segmented {
    display: inline-flex;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    overflow: hidden;
  }
  .segmented label {
    position: relative;
    display: inline-flex;
  }
  .segmented input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .segmented span {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--wt-tap-min);
    padding: 0 var(--wt-space-4);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
  }
  .segmented input:checked + span {
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
  }
  .segmented input:focus-visible + span {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;
