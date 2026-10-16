import { css, html, type TemplateResult } from "lit";

/** Draws `title` centred in a box as wide as the widest of `candidates`, so what sits beside the
 *  box stays put whichever candidate shows. The candidates are laid out unseen and unread in the
 *  same grid cell; the font rules sit on the box so the title and the candidates share them. */
export function fixedTitle(title: TemplateResult, candidates: readonly string[]): TemplateResult {
  return html`<div class="fixed-title">
    ${title}
    ${candidates.map(
      (candidate) => html`<span class="fixed-title-sizer" aria-hidden="true">${candidate}</span>`,
    )}
  </div>`;
}

export const fixedTitleStyles = css`
  .fixed-title {
    display: inline-grid;
    justify-items: center;
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
    font-variant-numeric: tabular-nums;
    text-align: center;
    text-wrap: nowrap;
  }
  .fixed-title > * {
    grid-area: 1 / 1;
    margin: 0;
    font: inherit;
  }
  .fixed-title > *::first-letter {
    text-transform: uppercase;
  }
  .fixed-title-sizer {
    visibility: hidden;
  }
`;
