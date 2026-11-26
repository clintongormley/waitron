import { css, html, nothing, type TemplateResult } from "lit";
import type { ServerRouter, ServerWaitingFor } from "../api/server-router.js";
import { codeMessage } from "../i18n/codes.js";
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

export function serverWaitingText(waitingFor: ServerWaitingFor | undefined): string {
  return t(waitingFor === "bucket" ? "server.checking_backup" : "server.waiting_sales");
}

export function serverConnectionNotice(
  noBoxAnswering: boolean,
  waitingFor?: ServerWaitingFor,
  action?: TemplateResult,
) {
  return html`<div
    class=${action ? "banner banner-with-action" : "banner"}
    role="status"
    data-server-status=${action ? "" : nothing}
  >
    <span>${noBoxAnswering ? t("server.none_answering") : serverWaitingText(waitingFor)}</span>
    ${action}
  </div>`;
}

export function attendanceConnectionRefusal(router: ServerRouter | undefined, write: boolean) {
  if (router?.noBoxAnswering) return t("server.none_answering");
  if (router?.waiting !== false) return serverWaitingText(router?.waitingFor);
  return codeMessage(write ? "attendance.write_failed" : "attendance.read_failed");
}
