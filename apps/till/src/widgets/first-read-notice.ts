import "@waitron/ui/src/components/wt-placeholder.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { css, html, nothing, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";
import type { FirstReadView } from "../state/first-read.js";

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

  .first-floor-read[data-starting] {
    box-sizing: border-box;
    min-block-size: 100%;
  }

  .first-floor-read:has(> wt-placeholder, > .map) {
    background: var(--wt-color-surface);
    border: 1px solid var(--wt-color-border);
    border-radius: calc((var(--wt-radius-md) + var(--wt-radius-lg)) / 2);
  }

  .first-floor-read > wt-placeholder {
    flex: 1;
    margin: var(--wt-space-2);
  }

  .first-content-read {
    position: relative;
    display: grid;
    gap: var(--wt-space-2);
    min-block-size: calc(var(--wt-tap-min) * 4);
    align-content: start;
  }

  .first-content-read wt-placeholder {
    min-block-size: var(--wt-tap-min);
  }

  .first-menu-read {
    box-sizing: border-box;
    max-block-size: calc(100dvh - var(--wt-tap-min) * 3);
    overflow: clip;
    grid-template-columns: repeat(
      auto-fill,
      minmax(max(calc(var(--wt-tap-min) * 2), calc((100% - var(--wt-space-2) * 5) / 6)), 1fr)
    );
    padding: var(--wt-space-3);
  }

  .first-menu-read:has(wt-placeholder) {
    background: var(--wt-color-surface);
  }

  .first-menu-read wt-placeholder {
    min-block-size: calc(var(--wt-tap-min) * 2);
  }

  .first-menu-read .first-read-notice {
    inset-inline: var(--wt-space-3);
  }

  .first-order-read {
    gap: 0;
  }

  .loading-order-heading,
  .loading-order-row {
    background: var(--wt-color-surface);
    padding-inline: var(--wt-space-4);
  }

  .loading-order-heading {
    padding-block: calc(var(--wt-space-3) + var(--wt-space-1) / 2)
      calc(var(--wt-space-2) - var(--wt-space-1) / 2);
  }

  .loading-order-heading wt-placeholder {
    inline-size: calc(var(--wt-tap-min) * 2 + var(--wt-space-1) / 2);
    min-block-size: var(--wt-space-3);
  }

  .loading-order-row {
    display: grid;
    grid-template-columns:
      calc(var(--wt-space-6) - var(--wt-space-1)) minmax(0, 1fr)
      calc(var(--wt-space-6) + var(--wt-space-5) - var(--wt-space-1));
    align-items: center;
    gap: var(--wt-space-3);
    padding-block: calc(var(--wt-space-3) + var(--wt-space-1) / 2);
    border-block-start: 1px solid var(--wt-color-border);
  }

  .loading-order-row:nth-of-type(2) {
    --name-bar-width: calc(var(--wt-space-5) * 7 + var(--wt-space-1) / 2);
  }

  .loading-order-row:nth-of-type(3) {
    --name-bar-width: calc(var(--wt-space-5) * 5);
  }

  .loading-order-row:nth-of-type(4) {
    --name-bar-width: calc(var(--wt-space-5) * 8 + var(--wt-space-2));
  }

  .loading-order-row:nth-of-type(5) {
    --name-bar-width: calc(var(--wt-space-5) * 6 - var(--wt-space-1));
  }

  .loading-order-row wt-placeholder:nth-child(2) {
    max-inline-size: var(--name-bar-width);
  }

  .loading-order-row wt-placeholder {
    min-block-size: var(--wt-space-4);
  }

  .loading-order-row wt-placeholder:first-child {
    min-block-size: calc(var(--wt-space-4) + var(--wt-space-1) / 2);
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
    --wt-spinner-track: var(--wt-color-border);
    --wt-spinner-arc: var(--wt-color-primary);
    flex: none;
    inline-size: var(--wt-space-4);
    block-size: var(--wt-space-4);
  }

  .first-read-notice svg {
    flex: none;
    inline-size: calc(var(--wt-space-5) - var(--wt-space-1) / 2);
    block-size: calc(var(--wt-space-5) - var(--wt-space-1) / 2);
    color: var(--wt-color-danger);
  }

  .first-read-notice strong {
    display: block;
    font-size: calc(var(--wt-font-size-md) + var(--wt-space-1) / 4);
  }

  .first-read-notice wt-button {
    margin-block-start: var(--wt-space-2);
  }

  @media (forced-colors: active) {
    .first-read-notice:is([data-stage="waiting"], [data-stage="unreachable"]) {
      outline: 1px solid CanvasText;
    }
  }
`;

export function firstReadNotice(stage: FirstReadView, handheld: boolean, retry?: () => void) {
  const waiting = stage === "waiting";
  const unreachable = stage === "unreachable";
  return html`<div class="first-read-notice" data-stage=${stage}>
    ${waiting ? html`<wt-spinner decorative></wt-spinner>` : nothing}
    ${
      unreachable
        ? html`<svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"
            />
            <path d="M3 3l18 18" />
          </svg>`
        : nothing
    }
    <div>
      <div role="status" data-first-read-status ?data-floor-read-failed=${unreachable}>
        ${
          waiting
            ? t("first_read.waiting")
            : unreachable
              ? html`<strong>${t("first_read.unreachable")}</strong>
                  ${t(handheld ? "first_read.phone_wifi" : "first_read.till_network")}`
              : nothing
        }
      </div>
      ${
        unreachable && retry !== undefined
          ? html`<wt-button data-floor-retry data-first-read-retry @click=${retry}
              >${t("first_read.retry")}</wt-button
            >`
          : nothing
      }
    </div>
  </div>`;
}

export function firstMenuRead(stage: FirstReadView, handheld: boolean, retry?: () => void) {
  return html`<div class="first-content-read first-menu-read">
    ${stage === "quiet" ? nothing : Array.from({ length: 72 }, () => html`<wt-placeholder></wt-placeholder>`)}
    ${firstReadNotice(stage, handheld, retry)}
  </div>`;
}

export function firstOrderRead(stage: FirstReadView, handheld: boolean) {
  return html`<div class="first-content-read first-order-read" data-loading>
    ${
      stage === "quiet"
        ? nothing
        : html`
            <div class="loading-order-heading" aria-hidden="true">
              <wt-placeholder></wt-placeholder>
            </div>
            ${Array.from(
              { length: 4 },
              () =>
                html`<div class="loading-order-row" aria-hidden="true">
                  <wt-placeholder></wt-placeholder>
                  <wt-placeholder></wt-placeholder>
                  <wt-placeholder></wt-placeholder>
                </div>`,
            )}
          `
    }
    ${firstReadNotice(stage, handheld)}
  </div>`;
}

export function firstFloorRead(
  stage: FirstReadView,
  handheld: boolean,
  retry: () => void,
  map?: TemplateResult,
  starting = false,
) {
  return html`<div class="first-floor-read" ?data-starting=${starting}>
    ${stage === "quiet" ? nothing : (map ?? html`<wt-placeholder></wt-placeholder>`)}
    ${firstReadNotice(stage, handheld, retry)}
  </div>`;
}

export function floorEmptyState(
  answered: boolean,
  hasTables: boolean,
  failed: boolean,
  retry: () => void,
) {
  if (answered)
    return html`<p data-floor-no-tables role="status">
      ${t(hasTables ? "floor.no_tables_today" : "floor.no_tables")}
    </p>`;
  if (!failed) return nothing;
  return html`<div class="read-failed">
    <p data-floor-read-failed role="status">${t("floor.read_failed")}</p>
    <wt-button data-floor-retry variant="secondary" @click=${retry}>
      ${t("find_page.retry")}
    </wt-button>
  </div>`;
}
