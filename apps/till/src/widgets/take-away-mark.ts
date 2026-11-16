import { css, html, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";

/** Outlined and in words, so a takeaway heading does not rest on colour. */
export const takeAwayMarkStyles = css`
  .take-away {
    padding: 0 var(--wt-space-1);
    border: 1px solid var(--wt-color-text);
    border-radius: var(--wt-radius-sm);
    font-weight: var(--wt-font-weight-bold);
    white-space: nowrap;
  }
`;

/** A kitchen card heading's mark that the order is taken away, so the station packs it. */
export function takeAwayMark(): TemplateResult {
  return html`<span class="take-away" data-take-away>${t("dining.takeaway")}</span>`;
}
