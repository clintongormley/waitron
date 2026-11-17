import { registerIcons, visuallyHiddenStyles } from "@waitron/ui";
import {
  type LitElement,
  type ReactiveController,
  type TemplateResult,
  css,
  html,
  nothing,
  unsafeCSS,
} from "lit";
import { thousandthsToDecimal, type TimingBand } from "@waitron/shared";
import type { ExpoItem } from "../api/client.js";
import { t } from "../i18n/t.js";
import {
  type BoardMeasure,
  CARD_COLUMN_TEXT_WIDTHS,
  OVERVIEW_COLUMN_REMS,
} from "../state/kitchen-board-fit.js";
import type { ColumnKey } from "../state/kitchen-columns.js";
import type { OverviewRow } from "../state/kitchen-overview.js";
import { extraNutrition } from "./diet-badges.js";
import { nutritionIcons } from "./nutrition-icons.js";
import { quantityText } from "./dish-format.js";
import { PHONE_WIDTH } from "./chooser-styles.js";
import { optionAnswers } from "./option-snapshot.js";
import { extraAmount } from "./queue-crossrefs.js";

registerIcons({
  "column-open": "M2 5.4 3.4 4 8 8.6 12.6 4 14 5.4 8 11.4Z",
  "column-closed": "M5.4 2 4 3.4 8.6 8 4 12.6 5.4 14 11.4 8Z",
});

/** Watches a zero-height line: changing the board layout also changes the host's height. */
export class BoardWidth implements ReactiveController {
  #resizing?: ResizeObserver;

  constructor(
    private readonly host: LitElement,
    private readonly measuredWidth: () => number | undefined,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.#observe();
  }

  hostUpdated(): void {
    this.#observe();
  }

  hostDisconnected(): void {
    this.#resizing?.disconnect();
    this.#resizing = undefined;
  }

  #observe(): void {
    if (this.#resizing || !this.host.isConnected) return;
    const probe = this.host.renderRoot?.querySelector(".width-probe");
    if (!probe) return;
    this.#resizing = new ResizeObserver((entries) => {
      if (entries.at(-1)!.contentRect.width !== this.measuredWidth()) this.host.requestUpdate();
    });
    this.#resizing.observe(probe);
  }
}

export function ageAccentClasses(band: TimingBand, reducedMotion?: boolean): string {
  const reduced = reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return `age-${band}${band === "forgotten" && !reduced ? " flash" : ""}`;
}

export const kitchenBoardStyles = css`
  .width-probe {
    height: 0;
  }

  .items,
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item,
  .line {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-left: var(--wt-space-1) solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
  }

  .item.state-queued,
  .line.state-queued {
    border-left-color: var(--wt-color-text-muted);
  }

  .item.state-preparing,
  .line.state-preparing {
    border-left-color: var(--wt-color-primary);
  }

  .item.state-ready,
  .line.state-ready {
    border-left-color: var(--wt-color-success);
  }

  .item.held,
  .line.held {
    border-style: dashed;
    border-left-style: solid;
    border-top-color: var(--wt-color-field-line);
    border-right-color: var(--wt-color-field-line);
    border-bottom-color: var(--wt-color-field-line);
    color: var(--wt-color-text-muted);
  }

  .item-modifiers,
  .item-crossrefs,
  .item-customisation,
  .line-modifiers,
  .line-crossrefs,
  .line-customisation {
    display: flex;
    flex-direction: column;
    padding-left: var(--wt-space-3);
    font-size: var(--wt-font-size-sm);
  }

  .item-modifiers,
  .item-crossrefs,
  .item-note,
  .line-modifiers,
  .line-crossrefs,
  .line-note {
    color: var(--wt-color-text-muted);
  }

  .line-diet {
    padding-left: var(--wt-space-3);
  }

  .extra-nutrition,
  .extra-allergens,
  .extra-diet {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1);
  }

  .extra-nutrition {
    margin-left: var(--wt-space-1);
  }

  .allergen-label {
    font-weight: var(--wt-font-weight-bold);
  }

  .item-allergens,
  .line-allergens {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1) var(--wt-space-2);
    padding-left: var(--wt-space-3);
    font-size: var(--wt-font-size-sm);
    color: var(--wt-color-text-muted);
  }

  .visually-hidden {
    ${visuallyHiddenStyles}
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
    min-width: 0;
  }

  .kanban .column {
    flex: 1 1 ${unsafeCSS(`${OVERVIEW_COLUMN_REMS}rem`)};
  }

  .kanban .column-overview {
    flex-grow: 0;
  }

  .kanban .column.collapsed {
    flex: 0 0 var(--wt-tap-min);
  }

  /* A tab panel or the narrow list spans the board, so a name would sit across the screen from its count. */
  .tab-panel .overview,
  .list .overview {
    max-width: calc(${unsafeCSS(CARD_COLUMN_TEXT_WIDTHS)} * var(--wt-font-size-md));
  }

  @media ${unsafeCSS(PHONE_WIDTH)} {
    .tab-panel .overview,
    .list .overview {
      max-width: none;
    }
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

  .held-part {
    margin: var(--wt-space-3) 0 var(--wt-space-1);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-medium);
    color: var(--wt-color-text-muted);
    text-transform: uppercase;
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
  return quantityText(thousandthsToDecimal(thousandths));
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

/** The heading over a column's held cards, below its other cards. */
export function heldPart(count: number): TemplateResult {
  return html`<h3 class="held-part" data-held-part>
    ${t("pass.column.held")}<span aria-hidden="true"> ·</span>
    <span data-held-count>${count}</span>
  </h3>`;
}

/** What a dish's sub-lines read, on the station's items and the pass's alike. */
type DishLines = Pick<ExpoItem, "id" | "note" | "asServed" | "modifiers" | "optionSnapshots">;

/** `prefix` names the sub-lines' classes: `line` on the station, `item` on the pass. */
export function dishNote(item: DishLines, prefix: string): TemplateResult | typeof nothing {
  const note = item.note ?? null;
  if (note === null || note === "") return nothing;
  return html`<span class="${prefix}-customisation" data-item-customisation=${item.id}>
    <span class="${prefix}-note" data-note>${note}</span>
  </span>`;
}

/** The dish's own allergen profile; each extra's own allergens are drawn beside the extra. */
export function dishAllergens(item: DishLines, prefix: string): TemplateResult | typeof nothing {
  const allergens = item.asServed?.allergens ?? {};
  if (Object.keys(allergens).length === 0) return nothing;
  return html`<span class="${prefix}-allergens" data-item-allergens=${item.id}>
    <span class="allergen-label">${t("allergens.contains")}</span>
    ${nutritionIcons(allergens, [], { size: "lg" })}
  </span>`;
}

/** A cook reads the kitchen wording of an answer and an extra's kitchen name, neither of which
 * carries per-language text. */
export function dishModifiers(item: DishLines, prefix: string): TemplateResult | typeof nothing {
  const modifiers = item.modifiers ?? [];
  const answers = optionAnswers(item.optionSnapshots, { reads: "kitchen" });
  if (modifiers.length === 0 && answers.length === 0) return nothing;
  return html`<span class="${prefix}-modifiers">
    ${answers.map((answer) => html`<span class="modifier-answer">${answer}</span>`)}
    ${modifiers.map(
      (modifier, i) =>
        html`<span class="modifier"
          >${`+ ${modifier.name}${extraAmount(modifier)}`}${extraNutrition(
            modifier,
            `item-modifier-allergens-${item.id}-${i}`,
            `item-modifier-diet-${item.id}-${i}`,
            { icons: true },
          )}</span
        >`,
    )}
  </span>`;
}
