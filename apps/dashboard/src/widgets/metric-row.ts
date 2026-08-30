import { type TemplateResult, css, html } from "lit";

/**
 * A shared LABEL/VALUE METRIC ROW — a muted label beside a bold value — used by both reporting
 * screens (the overview's takings/counts/tables tiles and the sales screen's record counts). It is a
 * pure render FUNCTION, not a custom element: it emits a fragment into the calling screen's own shadow
 * root, so it shares that screen's styles rather than owning a second shadow boundary (the same reason
 * the top-sellers table is a function too). The `.metric` CONTAINER layout is the screen's concern —
 * the overview lays its rows out `space-between` in a card, the sales screen packs them in a flex row —
 * so each screen keeps its own `.metric { … }` rule; only the inner chrome ({@link metricStyles}) is
 * shared here, since that is byte-identical across both.
 */
export function renderMetric(label: string, value: string, test: string): TemplateResult {
  return html`<div class="metric">
    <span class="label">${label}</span>
    <span class="value" data-test=${test}>${value}</span>
  </div>`;
}

/** The inner chrome of a {@link renderMetric} row — the muted label and the bold value. Add it to a
 * screen's `static styles` alongside that screen's own `.metric` container rule. Tokens only, so it
 * follows the venue's theme. */
export const metricStyles = css`
  .metric .label {
    color: var(--wt-color-text-muted);
  }
  .metric .value {
    font-weight: var(--wt-font-weight-bold);
  }
`;
