import { registerIcons, visuallyHiddenStyles } from "@waitron/ui";
import { type TemplateResult, css, html, nothing } from "lit";
import { thousandthsToDecimal } from "@waitron/shared";
import { t } from "../i18n/t.js";
import type { BoardMeasure } from "../state/kitchen-board-fit.js";
import type { ColumnKey } from "../state/kitchen-columns.js";
import type { OverviewRow } from "../state/kitchen-overview.js";
import { trimQuantity } from "./dish-format.js";

registerIcons({
  "column-open": "M2 5.4 3.4 4 8 8.6 12.6 4 14 5.4 8 11.4Z",
  "column-closed": "M5.4 2 4 3.4 8.6 8 4 12.6 5.4 14 11.4 8Z",
});

/** The column headings and Overview a kitchen board (the station's and the pass's) draws. */
export const kitchenBoardStyles = css`
  .visually-hidden {
    ${visuallyHiddenStyles}
  }

  .overview {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    margin: 0;
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    list-style: none;
  }

  .overview-row {
    display: flex;
    align-items: baseline;
    gap: var(--wt-space-2);
  }

  .overview-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .overview-making {
    font-weight: var(--wt-font-weight-bold);
  }

  .overview-held {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .column-heading {
    display: flex;
    margin: 0 0 var(--wt-space-1);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    color: var(--wt-color-text-muted);
    text-transform: uppercase;
  }

  .collapsed .column-heading {
    flex: 1;
    margin: 0;
  }

  .column-toggle {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--wt-space-1);
    min-width: 0;
    min-height: var(--wt-tap-min);
    margin: 0;
    padding: 0 var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: inherit;
    font: inherit;
    text-align: start;
    text-transform: inherit;
    cursor: pointer;
  }

  .collapsed .column-toggle {
    justify-content: flex-start;
    padding: var(--wt-space-2) 0;
    writing-mode: vertical-rl;
  }

  .collapsed .column-toggle[data-late] {
    box-shadow: inset 0 var(--wt-space-1) 0 var(--wt-color-danger);
  }

  .column:not(.collapsed) .column-count {
    margin-inline-start: auto;
  }
`;

/** The host's width and sizes, read before a drawing so the first is already the right layout. */
export function measureBoard(host: HTMLElement): BoardMeasure {
  const own = getComputedStyle(host);
  const px = (token: string) => parseFloat(own.getPropertyValue(token));
  return {
    width: host.getBoundingClientRect().width,
    textPx: parseFloat(own.fontSize),
    remPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    tapMinPx: px("--wt-tap-min"),
    gapPx: px("--wt-space-3"),
  };
}

function dishCount(thousandths: number): string {
  return trimQuantity(thousandthsToDecimal(thousandths));
}

export function overviewList(rows: readonly OverviewRow[]): TemplateResult {
  return html`<ul class="overview" data-overview>
    ${rows.map(
      (row) =>
        html`<li class="overview-row" data-overview-row>
          <span class="overview-name">${row.name}</span
          ><span class="overview-making" data-overview-making>${dishCount(row.making)}</span>${
            row.held > 0
              ? html`<span class="overview-held" data-overview-held aria-hidden="true"
                    >+${dishCount(row.held)}</span
                  ><span class="visually-hidden"
                    >, ${t("station.overview_held").replace("{n}", dishCount(row.held))}</span
                  >`
              : nothing
          }
        </li>`,
    )}
  </ul>`;
}

/** The count's words while late: "1, 1 late" in one hidden span, as the drawn count is hidden
 * then; a hidden span after the drawn count puts a space before its comma in Chromium's name. */
export function lateWords(count: number, late: number): TemplateResult | typeof nothing {
  if (late === 0) return nothing;
  return html`<span class="visually-hidden"
    >${count}, ${t("station.late").replace("{n}", String(late))}</span
  >`;
}

/** One button template for both states, so a redraw keeps the focused element. */
export function columnHeading(
  key: ColumnKey,
  title: string,
  count: number,
  collapsed: boolean,
  onToggle: () => void,
  late = 0,
): TemplateResult {
  return html`<h2 class="column-heading">
    <button
      class="column-toggle"
      data-column-toggle=${key}
      ?data-late=${late > 0}
      aria-expanded=${collapsed ? "false" : "true"}
      @click=${onToggle}
    >
      ${collapsed ? html`<wt-icon name="column-closed" aria-hidden="true"></wt-icon>` : nothing}<span
        class="column-title"
        >${title}</span
      >
      ${collapsed ? html`<span aria-hidden="true">·</span> ` : nothing}<span
        class="column-count"
        data-column-count
        aria-hidden=${late > 0 ? "true" : nothing}
        >${count}</span
      >${lateWords(count, late)}${collapsed ? nothing : html`<wt-icon name="column-open" aria-hidden="true"></wt-icon>`}
    </button>
  </h2>`;
}
