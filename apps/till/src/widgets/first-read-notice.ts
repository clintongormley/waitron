import { css, html, nothing } from "lit";
import { registerIcons } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { FirstReadView } from "../state/first-read.js";

registerIcons({
  "first-read-offline":
    "M1 5a11 11 0 0 1 14 0l-1 1a10 10 0 0 0-5.4-2.3L7 2.1A11.3 11.3 0 0 1 15 5l-1 1zM4 8a6.3 6.3 0 0 1 2.2-1.2l-1-1A8 8 0 0 0 3 7zM5.5 10l1 1a2.7 2.7 0 0 1 2.7-.6L8 9a4 4 0 0 0-2.5 1zM8 12.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM1.5 1.5l1-1 13 13-1 1z",
});

export const firstReadNoticeStyles = css`
  .first-floor-read {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-block-size: calc(var(--wt-tap-min) * 4);
    margin-inline: var(--wt-space-3);
  }

  .screen[data-floor-footer] .first-floor-read {
    margin-inline: 0;
  }

  .first-floor-read:has(wt-placeholder) {
    background: var(--wt-color-surface);
    border-radius: var(--wt-radius-md);
  }

  .first-floor-read wt-placeholder {
    flex: 1;
    margin: var(--wt-space-2);
  }

  .read-failed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
  }

  .read-failed p {
    margin: 0;
  }

  .first-read-notice {
    position: absolute;
    inset-block-start: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
    inset-inline: 0;
    z-index: 1;
  }

  .first-read-notice:is([data-stage="waiting"], [data-stage="unreachable"]) {
    display: flex;
    align-items: flex-start;
    gap: var(--wt-space-2);
    padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2)
      calc(var(--wt-space-3) + var(--wt-space-1) / 2);
    border-radius: calc(var(--wt-radius-md) + var(--wt-space-1) / 2);
    font-size: var(--wt-font-size-md);
    box-shadow: var(--wt-shadow-2);
  }

  .first-read-notice[data-stage="waiting"] {
    align-items: center;
    background: var(--wt-color-surface-lifted);
    color: var(--wt-color-text-muted);
  }

  .first-read-notice[data-stage="unreachable"] {
    background: var(--wt-color-tab-danger-tint);
    color: var(--wt-color-text);
  }

  .first-read-notice wt-spinner {
    flex: none;
    inline-size: var(--wt-space-4);
    block-size: var(--wt-space-4);
    color: var(--wt-color-primary);
  }

  .first-read-notice wt-icon {
    flex: none;
    color: var(--wt-color-danger);
  }

  .first-read-notice strong {
    display: block;
    font-size: calc(var(--wt-font-size-md) + var(--wt-space-1) / 4);
  }

  .first-read-notice wt-button {
    margin-block-start: var(--wt-space-2);
    --wt-action-border-color: var(--wt-color-danger);
  }

  @media (forced-colors: active) {
    .first-read-notice:is([data-stage="waiting"], [data-stage="unreachable"]) {
      outline: 1px solid CanvasText;
    }
  }
`;

export function firstReadNotice(stage: FirstReadView, retry: () => void) {
  const waiting = stage === "waiting";
  const unreachable = stage === "unreachable";
  return html`<div class="first-read-notice" data-stage=${stage}>
    ${waiting ? html`<wt-spinner decorative></wt-spinner>` : nothing}
    ${unreachable ? html`<wt-icon name="first-read-offline" size="lg"></wt-icon>` : nothing}
    <div>
      <div role="status" data-first-read-status ?data-floor-read-failed=${unreachable}>
        ${
          waiting
            ? t("first_read.waiting")
            : unreachable
              ? html`<strong>${t("first_read.unreachable")}</strong>${t("offline.wifi")}`
              : nothing
        }
      </div>
      ${
        unreachable
          ? html`<wt-button data-floor-retry @click=${retry}>${t("first_read.retry")}</wt-button>`
          : nothing
      }
    </div>
  </div>`;
}

export function firstFloorRead(stage: FirstReadView, retry: () => void) {
  return html`<div class="first-floor-read">
    ${stage === "quiet" ? nothing : html`<wt-placeholder></wt-placeholder>`}
    ${firstReadNotice(stage, retry)}
  </div>`;
}

export function floorReadFailure(retry: () => void) {
  return html`<div class="read-failed">
    <p data-floor-read-failed role="status">${t("floor.read_failed")}</p>
    <wt-button data-floor-retry variant="secondary" @click=${retry}>
      ${t("find_page.retry")}
    </wt-button>
  </div>`;
}
