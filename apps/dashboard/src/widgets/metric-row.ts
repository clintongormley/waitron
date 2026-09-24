import { type TemplateResult, css, html } from "lit";

/**
 * A pure render FUNCTION, not a custom element: it emits a fragment into the calling screen's own
 * shadow root, so it shares that screen's styles. The `.metric` CONTAINER layout is the screen's
 * concern, so each screen keeps its own `.metric { … }` rule; only the inner chrome
 * ({@link metricStyles}) is shared here.
 */
export function renderMetric(label: string, value: string, test: string): TemplateResult {
  return html`<div class="metric">
    <span class="label">${label}</span>
    <span class="value" data-test=${test}>${value}</span>
  </div>`;
}

export const metricStyles = css`
  .metric .label {
    color: var(--wt-color-text-muted);
  }
  .metric .value {
    font-weight: var(--wt-font-weight-bold);
  }
`;
