import { css, html, nothing, type TemplateResult } from "lit";
import type { TableState } from "../api/floor-api.js";
import { fill, t } from "../i18n/t.js";
import type { FirstReadView } from "../state/first-read.js";
import { detailsHeading } from "../state/floor-today.js";
import {
  firstMenuRead,
  firstOrderRead,
  firstReadNoticeStyles,
} from "../widgets/first-read-notice.js";

export const tableOrderLoadingStyles = [
  firstReadNoticeStyles,
  css`
    .loading-screen {
      box-sizing: border-box;
    }

    .loading-screen:not([data-embedded]) {
      min-block-size: 100dvh;
    }

    .loading-screen > :is(.head, .head-actions) {
      padding-inline: var(--wt-space-4);
    }

    .loading-screen:has(> .loading-foot):not([data-embedded]) {
      padding-block-end: 0;
    }

    .loading-foot {
      margin-block-start: auto;
      position: sticky;
      inset-block-end: 0;
      padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2) var(--wt-space-4)
        max(calc(var(--wt-space-5) + var(--wt-space-1) / 2), env(safe-area-inset-bottom));
      border-block-start: 1px solid var(--wt-color-border);
      background: var(--wt-color-surface);
    }

    .loading-foot wt-button {
      display: block;
    }

    .loading-foot wt-button::part(button) {
      inline-size: 100%;
      min-block-size: calc(var(--wt-tap-min) + var(--wt-space-2));
    }
  `,
];

export function tableOrderLoading({
  table,
  menuRead,
  orderRead,
  handheld,
  retry,
  embedded,
  orderId,
  backButton,
  wide,
}: {
  table: TableState | undefined;
  menuRead: FirstReadView | undefined;
  orderRead: FirstReadView;
  handheld: boolean;
  retry: (() => void) | undefined;
  embedded: boolean;
  orderId: string | undefined;
  backButton: TemplateResult | typeof nothing;
  wide: boolean;
}): TemplateResult {
  const guests = table?.party?.guestCount;
  const menu =
    menuRead === undefined
      ? firstMenuRead(orderRead === "quiet" ? "quiet" : "placeholder", handheld)
      : html`<till-menu-browser
          data-loading
          .firstRead=${menuRead}
          .retryFirstRead=${retry}
          .handheld=${handheld}
        ></till-menu-browser>`;
  const order = firstOrderRead(
    menuRead === undefined || orderRead === "quiet" ? orderRead : "placeholder",
    handheld,
  );
  return html`
    <section
      class="screen loading-screen"
      ?data-embedded=${embedded}
      data-order-id=${orderId ?? nothing}
      aria-label=${t("table.title")}
      aria-busy=${menuRead === undefined && (orderRead === "quiet" || orderRead === "placeholder") ? "true" : nothing}
    >
      ${
        embedded
          ? nothing
          : html`<header class="head">
              <h1 class="title">${t("table.title")}</h1>
            </header>`
      }
      <div class="head-actions">
        ${backButton}
        ${
          table === undefined
            ? nothing
            : html`<div data-opening-table>
                <strong>${detailsHeading(table, table.today?.joinName ?? null)}</strong>
                ${guests == null ? nothing : fill(t("table.menu_guests"), { n: String(guests) })}
              </div>`
        }
      </div>
      ${
        wide
          ? html`<div class="ordering side-by-side">
              <div class="browsing">${menu}</div>
              <div class="draft-pane">${order}</div>
            </div>`
          : html`${menuRead === undefined ? order : menu}
              <footer class="loading-foot">
                <wt-button variant="secondary" disabled>${t("table.view_menu")}</wt-button>
              </footer>`
      }
    </section>
  `;
}
