import type { ProductAllergens } from "@waitron/shared";
import { type Decimal, formatMoney } from "@waitron/shared";
import {
  DROPDOWN_ICONS,
  currentContentLanguages,
  preventTouchContextMenu,
  registerIcons,
} from "@waitron/ui";
import { type TemplateResult, css, html, nothing } from "lit";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { BlockReason } from "../state/menu-refresh.js";
import { quantityLabel } from "../state/order-line.js";
import type { OrderLine, SelectedExtra } from "../state/working-order.js";
import { extraNutrition } from "./diet-badges.js";
import { quantityText } from "./dish-format.js";
import { optionAnswers } from "./option-snapshot.js";
import { lineProductName, soldByTheUnit } from "./product-name.js";
import { setMenuTag } from "./set-menu-presentation.js";

registerIcons(DROPDOWN_ICONS);

export function pickQuantityBadge(quantity: number): string {
  return quantity > 1 ? ` ×${quantity}` : "";
}

export function notOfferedMarker() {
  return html` <span class="not-offered">${t("basket.not_offered")}</span>`;
}

const BLOCKED_WORDS: Record<BlockReason, StringKey> = {
  period_ended: "basket.blocked.period_ended",
  removed: "basket.blocked.removed",
  variant_removed: "basket.blocked.removed",
  not_sold_separately: "basket.blocked.not_sold_separately",
  unavailable: "basket.blocked.unavailable",
  extra_removed: "basket.blocked.extra",
  extra_unavailable: "basket.blocked.extra",
  unit_changed: "basket.blocked.unit",
  choice_required: "basket.blocked.extra",
  extras_limit: "basket.blocked.extra",
};

/** A line a menu change stops being paid until it is removed or replaced (D9). */
function blockedMarker(reason: BlockReason) {
  return html` <span class="not-offered">${t(BLOCKED_WORDS[reason])}</span>`;
}

/** An unsent dish whose period ended earlier today: a warning, not a block. */
function periodEndedMarker(period: string) {
  return html` <span class="period-ended" data-period-ended
    ><span aria-hidden="true">⚠</span>
    ${t("basket.period_ended").replace("{period}", () => period)}</span
  >`;
}

/** The marks beside a dish's name: not offered, blocked, its period ended, or refused by the server. */
export function lineMarks(line: OrderLine) {
  const ended = line.blocked === undefined ? line.endedPeriod : undefined;
  return html`${line.notOffered ? notOfferedMarker() : nothing}${
    line.blocked === undefined ? nothing : blockedMarker(line.blocked)
  }${ended === undefined ? nothing : periodEndedMarker(ended.periodName)}${
    line.unavailableOnServer === true && line.blocked === undefined && line.notOffered === undefined
      ? html` <span class="not-offered">${t("basket.blocked.server")}</span>`
      : nothing
  }`;
}

export interface DraftRowView {
  line: OrderLine;
  index: number;
  /** {@link draftLinePrice}'s figure, so the row shows what the order total adds. */
  price: Decimal;
  /** The set-menu place's surcharge, for its tag; absent on a dish outside a set menu. */
  setMenuPrice?: string;
  /** The dish's own allergen and diet icons. */
  nutrition: TemplateResult | typeof nothing;
  extraNutrition: (
    extra: SelectedExtra,
  ) => { addAllergens: ProductAllergens | null; suitableFor: readonly string[] } | undefined;
  lastAdded: boolean;
  disabled: boolean;
  open: () => void;
}

/**
 * A new dish as one row. The screen fills `lead-<n>` (the selection box), `mark-<n>` (beside the
 * name: the guest allergy mark), `end-<n>` (the split control), and `before-<n>` and `after-<n>`
 * around it.
 */
export function draftRow(view: DraftRowView): TemplateResult {
  const { line, index } = view;
  const name = lineProductName(line.product);
  const quantity =
    line.notOffered || soldByTheUnit(line.product)
      ? quantityText(line.quantity)
      : quantityLabel(line);
  const price = formatMoney(view.price, currentLocale());
  const more = [
    ...(line.extras ?? []).map((extra, i) => {
      const own = view.extraNutrition(extra);
      return html`<span data-draft-extra
        >${extra.name}${pickQuantityBadge(extra.quantity)}${
          own
            ? extraNutrition(own, `option-allergens-${index}-${i}`, `option-diet-${index}-${i}`)
            : nothing
        }</span
      >`;
    }),
    ...(line.notOfferedExtras ?? []).map(
      (extra) =>
        html`<span data-draft-extra
          >${extra.name}${pickQuantityBadge(extra.quantity)}${notOfferedMarker()}</span
        >`,
    ),
    ...optionAnswers(line.optionSnapshots, { reads: "staff" }).map(
      (answer) => html`<span>${answer}</span>`,
    ),
    ...(line.note === undefined ? [] : [html`<span>${line.note}</span>`]),
  ];
  const ended = line.blocked === undefined && line.endedPeriod !== undefined;
  return html`<slot name=${`before-${index}`}></slot>
    <div
      class=${ended ? "entry draft-row period-ended-entry" : "entry draft-row"}
      part="entry"
      ?data-last-added=${view.lastAdded}
    >
      <slot class="draft-row-lead" name=${`lead-${index}`}></slot>
      <button
        type="button"
        class="draft-row-open"
        data-line-detail=${index}
        data-draft-row=${index}
        ?disabled=${view.disabled}
        @click=${view.open}
        @contextmenu=${preventTouchContextMenu}
      >
        <span class="draft-row-qty">${quantity}</span>
        <span class="draft-row-text"
          ><span class="draft-row-name"
            ><span class="product-name" lang=${currentContentLanguages().defaultLanguage}
              >${name}</span
            >${setMenuTag(view.setMenuPrice)}${view.nutrition}<slot name=${`mark-${index}`}></slot
            >${lineMarks(line)}</span
          >${
            more.length === 0
              ? nothing
              : html`<span class="draft-row-more"
                  >${more.map((part, i) => (i === 0 ? part : html` · ${part}`))}</span
                >`
          }</span
        >
        <span class="draft-row-price">${price}</span>
      </button>
      <slot class="draft-row-end" name=${`end-${index}`}></slot>
      <div class="line-after draft-row-after"><slot name=${`after-${index}`}></slot></div>
    </div>`;
}

const LEAD_WIDTH = css`calc(var(--wt-space-6) + var(--wt-space-1))`;

/** Last in the basket's styles; each rule matches the specificity of the line-details grid it overrides. */
export const draftRowStyles = css`
  :host .order-lines > .entry.draft-row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: ${LEAD_WIDTH} minmax(0, 1fr) auto;
    align-items: center;
    min-height: calc(var(--wt-tap-min) + var(--wt-space-2));
    background: var(--wt-color-surface);
    border-bottom: 1px solid var(--wt-color-border);
  }
  :host .order-lines > .entry.draft-row[data-last-added] {
    background: var(--wt-color-surface-lifted);
  }
  :host .draft-row > .draft-row-lead {
    display: grid;
    grid-column: 1;
    place-items: center;
    align-self: stretch;
  }
  :host .draft-row > .draft-row-open {
    grid-column: 2;
    display: grid;
    grid-template-columns:
      minmax(calc(var(--wt-space-5) + var(--wt-space-1)), max-content) minmax(0, 1fr)
      auto;
    align-items: center;
    gap: var(--wt-space-2);
    min-height: var(--wt-tap-min);
    margin: 0;
    padding: var(--wt-space-1) var(--wt-space-1) var(--wt-space-1) 0;
    border: 0;
    background: transparent;
    color: var(--wt-color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .draft-row-open:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: calc(-1 * var(--wt-focus-offset));
  }
  .draft-row-open:disabled {
    cursor: default;
  }
  .draft-row-qty {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
  }
  .draft-row-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .draft-row-name {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-medium);
  }
  .draft-row-more {
    display: block;
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
    color: var(--wt-color-text-muted);
  }
  .draft-row-price {
    font-size: var(--wt-font-size-md);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  :host .draft-row > .draft-row-end {
    display: grid;
    grid-column: 3;
    align-self: stretch;
  }
  :host .draft-row > .draft-row-after {
    grid-column: 1 / -1;
  }
`;

/** The selection box's drawing, for the button the screen puts in `lead-<n>`. */
export function draftSelectBox(selected: boolean): TemplateResult {
  return html`<span class="draft-select-box" aria-hidden="true" ?data-ticked=${selected}
    >${selected ? html`<wt-icon name="check"></wt-icon>` : nothing}</span
  >`;
}

/** The split control's drawing, for the button the screen puts in `end-<n>`. */
export function draftSplitChevron(): TemplateResult {
  return html`<wt-icon name="chevron-down" size="lg" aria-hidden="true"></wt-icon>`;
}

/**
 * For the screen's own styles: what it slots into a row lives in the screen's tree, out of reach
 * of the basket's.
 */
export const draftRowSlotStyles = css`
  .draft-row-select,
  .draft-row-split {
    display: grid;
    place-items: center;
    min-height: var(--wt-tap-min);
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--wt-color-text-muted);
    font: inherit;
    cursor: pointer;
  }
  .draft-row-select {
    width: ${LEAD_WIDTH};
  }
  .draft-row-split {
    width: calc(var(--wt-space-6) + var(--wt-space-2));
  }
  .draft-row-select:disabled,
  .draft-row-split:disabled {
    cursor: default;
  }
  .draft-select-box {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--wt-space-5);
    height: var(--wt-space-5);
    border: 2px solid var(--wt-color-border);
    border-radius: calc(var(--wt-radius-sm) * 1.5);
    background: var(--wt-color-surface);
  }
  .draft-select-box[data-ticked] {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-primary);
  }
  .draft-select-box wt-icon {
    color: var(--wt-color-on-primary);
  }
  .draft-row-split wt-icon {
    color: var(--wt-color-text-muted);
  }
`;
