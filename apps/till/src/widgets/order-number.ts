import { css, html, nothing, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";

/** For the element that holds `orderNumber`'s output; a host whose number is bold keeps it bold. */
export const orderNumberStyles = css`
  .was {
    color: var(--wt-color-text-muted);
    font-weight: var(--wt-font-weight-normal);
    white-space: nowrap;
  }
`;

/** `#27`, followed by a muted `(was 28, 30)` when the order's dishes went to the kitchen under other
 * numbers. */
export function orderNumber(n: number, formerNumbers?: number[]): TemplateResult {
  const was =
    formerNumbers && formerNumbers.length > 0
      ? t("order.was_numbers").replace("{numbers}", () => formerNumbers.join(", "))
      : null;
  return html`#${n}${was === null ? nothing : html` <span class="was">${was}</span>`}`;
}
