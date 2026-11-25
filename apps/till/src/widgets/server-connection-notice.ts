import { css, html } from "lit";
import { t } from "../i18n/t.js";

export const serverConnectionNoticeStyles = css`
  .banner {
    margin: 0 0 var(--wt-space-3);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text-muted);
    text-align: center;
  }
`;

export function serverConnectionNotice(noBoxAnswering: boolean) {
  return html`<p class="banner" role="status">
    ${t(noBoxAnswering ? "server.none_answering" : "server.waiting_sales")}
  </p>`;
}
