import { css, html, nothing, type TemplateResult } from "lit";
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

  .banner-with-action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--wt-space-2);
  }
`;

export function serverConnectionNotice(noBoxAnswering: boolean, action?: TemplateResult) {
  return html`<div
    class=${action ? "banner banner-with-action" : "banner"}
    role="status"
    data-server-status=${action ? "" : nothing}
  >
    <span>${t(noBoxAnswering ? "server.none_answering" : "server.waiting_sales")}</span>
    ${action}
  </div>`;
}
