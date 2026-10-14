import { css, html, nothing, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";

/** The bracket sits inside the host's bold number span, so it sets normal weight itself. */
export const orderNumberStyles = css`
  .was {
    color: var(--wt-color-text-muted);
    font-weight: var(--wt-font-weight-normal);
    white-space: nowrap;
  }
`;

export function orderNumber(n: number, formerNumbers?: number[]): TemplateResult {
  const was =
    formerNumbers && formerNumbers.length > 0
      ? t("order.was_numbers").replace("{numbers}", () => formerNumbers.join(", "))
      : null;
  return html`#${n}${was === null ? nothing : html` <span class="was">${was}</span>`}`;
}
