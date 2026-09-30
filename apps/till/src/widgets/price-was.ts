import { css, html, type TemplateResult } from "lit";
import { compareDecimal, formatMoney, type Decimal } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";

export const priceWasStyles = css`
  .list-total {
    color: var(--wt-color-text-muted);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;

/** A line's total; after a give-away or a discount, the total it had first, struck through. */
export function lineTotal(before: Decimal, now: Decimal, className = "line-total"): TemplateResult {
  if (compareDecimal(before, now) === 0)
    return html`<span class=${className}>${formatMoney(now, currentLocale())}</span>`;
  return html`<span class=${className}
    ><span class="visually-hidden" data-price-was>${t("table.price_was")} </span
    ><s class="list-total">${formatMoney(before, currentLocale())}</s>
    ${formatMoney(now, currentLocale())}</span
  >`;
}
