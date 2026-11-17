import { css, html } from "lit";

export { paintRow } from "./paint-row.js";
export { flatParent, scrollTargets } from "./flat-tree.js";
export { DaySwipe, PHONE_WIDTH, SWIPE_PX } from "./day-swipe.js";

export const seasonStepperStyles = css`
  .season {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-1);
  }
  .chip {
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-full);
    padding: var(--wt-space-1) var(--wt-space-3);
    white-space: nowrap;
  }
  .chip[data-tint] {
    background: var(--season-tint);
    color: var(--season-on-tint);
    border-color: var(--season-tint-line);
  }
  .covers {
    margin: 0;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
`;

export function seasonStepper(options: {
  label: string;
  tint: string;
  previousLabel: string;
  nextLabel: string;
  disabled: boolean;
  step: (by: number) => void;
}) {
  return html`<span slot="picker" class="season">
    <wt-button
      data-test="previous-season"
      variant="ghost"
      aria-label=${options.previousLabel}
      ?disabled=${options.disabled}
      @click=${() => options.step(-1)}
      >‹</wt-button
    >
    <span class="chip" data-test="season" data-tint=${options.tint}>${options.label}</span>
    <wt-button
      data-test="next-season"
      variant="ghost"
      aria-label=${options.nextLabel}
      ?disabled=${options.disabled}
      @click=${() => options.step(1)}
      >›</wt-button
    >
  </span>`;
}

// A grid fills its slot less its heading rows, their line, and its two borders.
export const paintGridFill = (headingRows: 1 | 2) =>
  css`calc(100cqb - var(--wt-tap-min) * ${headingRows} - 3px)`;
