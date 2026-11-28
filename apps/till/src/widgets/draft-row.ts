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
import type { OrderLine, SelectedExtra, WorkingOrderStore } from "../state/working-order.js";
import { extraNutrition } from "./diet-badges.js";
import { quantityText } from "./dish-format.js";
import { optionAnswers } from "./option-snapshot.js";
import { lineProductName, soldByTheUnit } from "./product-name.js";
import { rowMore, rowTextStyles } from "./row-text.js";
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
  price: Decimal;
  /** The supplement if this dish fits a saved set menu. */
  setMenuPrice?: string;
  /** The dish's own allergen and diet icons. */
  nutrition: TemplateResult | typeof nothing;
  extraNutrition: (
    extra: SelectedExtra,
  ) => { addAllergens: ProductAllergens | null; suitableFor: readonly string[] } | undefined;
  lastAdded: boolean;
  /** Open in place: boxed, with the screen's controls in `opened-<n>` under the row. */
  opened: boolean;
  /** Held ready to drag: the row is outlined. */
  dragging: boolean;
  disabled: boolean;
  open: () => void;
}

/** What a compact row's tap sends; the screen holding the basket decides what it opens. */
export interface DraftRowTap {
  store: WorkingOrderStore;
  line: OrderLine;
  index: number;
}

export const draftRowTap = (store: WorkingOrderStore, line: OrderLine, index: number) =>
  new CustomEvent<DraftRowTap>("draft-row-tap", {
    detail: { store, line, index },
    bubbles: true,
    composed: true,
  });

const isCounted = (line: OrderLine) => line.notOffered === true || soldByTheUnit(line.product);

/**
 * The row as staff read it — dish, quantity, guest and second line — since the box sits outside
 * the row's own button.
 */
export function draftSelectLabel(line: OrderLine, guest: string | undefined): string {
  const quantity = isCounted(line) ? `×${quantityText(line.quantity)}` : quantityLabel(line);
  return [
    t("table.select_line"),
    `${lineProductName(line.product)} ${quantity}`,
    ...(guest === undefined ? [] : [guest]),
    ...[...(line.extras ?? []), ...(line.notOfferedExtras ?? [])].map(
      (extra) => `${extra.name}${pickQuantityBadge(extra.quantity)}`,
    ),
    ...optionAnswers(line.optionSnapshots, { reads: "staff" }),
    ...(line.note === undefined ? [] : [line.note]),
  ].join(" · ");
}

/**
 * A new dish as one row. The screen fills `lead-<n>` (the selection box), `mark-<n>` (beside the
 * name: the guest allergy mark), `end-<n>` (the split control), `opened-<n>` (an opened row's
 * controls), and `before-<n>` and `after-<n>` around it.
 */
export function draftRow(view: DraftRowView): TemplateResult {
  const { line, index } = view;
  const name = lineProductName(line.product);
  const quantity = isCounted(line) ? quantityText(line.quantity) : quantityLabel(line);
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
    ...(line.optionSnapshots ?? []).map(
      (snapshot) => html`<span>${Object.values(snapshot.labelName)[0] ?? ""}</span>`,
    ),
    ...(line.note === undefined ? [] : [html`<span>${line.note}</span>`]),
  ];
  const ended = line.blocked === undefined && line.endedPeriod !== undefined;
  return html`<slot name=${`before-${index}`}></slot>
    <div
      class=${ended ? "entry draft-row period-ended-entry" : "entry draft-row"}
      part=${view.opened ? "entry opened-entry" : "entry"}
      ?data-last-added=${view.lastAdded}
      ?data-open=${view.opened}
      ?data-draft-dragging=${view.dragging}
    >
      <slot class="draft-row-lead" name=${`lead-${index}`}></slot>
      <button
        type="button"
        class="draft-row-open"
        data-line-detail=${index}
        data-draft-row=${index}
        aria-expanded=${view.opened}
        ?disabled=${view.disabled}
        @click=${view.open}
        @contextmenu=${preventTouchContextMenu}
      >
        <span class="row-qty">${quantity}</span>
        <span class="row-text"
          ><span class="row-name"
            ><span class="product-name" lang=${currentContentLanguages().defaultLanguage}
              >${name}</span
            >${setMenuTag(view.setMenuPrice)}${view.nutrition}<slot name=${`mark-${index}`}></slot
            >${lineMarks(line)}</span
          >${rowMore(more)}</span
        >
        <span class="row-price">${price}</span>
      </button>
      <slot class="draft-row-end" name=${`end-${index}`}></slot>
      <slot class="draft-row-opened" name=${`opened-${index}`}></slot>
      <div class="line-after draft-row-after"><slot name=${`after-${index}`}></slot></div>
    </div>`;
}

const LEAD_WIDTH = css`var(--wt-tap-min)`;
const OPEN_BORDER = css`2px`;
/** How far an opened row's box sits in from a closed row's end: its side margin and border. */
const OPEN_INSET = css`calc(var(--wt-space-2) + ${OPEN_BORDER})`;

/** Last in the basket's styles; each rule matches the specificity of the line-details grid it overrides. */
export const draftRowStyles = css`
  :host .order-lines > .entry.draft-row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: ${LEAD_WIDTH} minmax(0, 1fr) var(--wt-tap-min);
    grid-template-rows: 1fr auto;
    column-gap: 0;
    align-items: center;
    min-height: calc(var(--wt-tap-min) + var(--wt-space-2));
    background: var(--wt-color-surface);
    /* Drawn inside the row, so the selection and split targets reach its full height. */
    box-shadow: inset 0 -1px 0 var(--wt-color-border);
  }
  :host .order-lines > .entry.draft-row[data-last-added] {
    background: var(--wt-color-surface-lifted);
  }
  /* --wt-color-success text is under 4.5:1 on the lifted surface in light; the border keeps the green. */
  :host .draft-row[data-last-added] .diet-badge {
    color: var(--wt-color-text);
  }
  /* Without a split arrow the price ends --wt-space-2 in from the box's edge, as frame g 3 draws
     it; with one, the end column reaches out over the box's margin and border, so the price and
     arrow keep the closed rows' column. */
  :host .order-lines > .entry.draft-row[data-open] {
    grid-template-columns: ${LEAD_WIDTH} minmax(0, 1fr) auto;
    grid-template-rows: minmax(calc(var(--wt-tap-min) + var(--wt-space-2)), auto) auto;
    margin: var(--wt-space-1) var(--wt-space-2);
    border: ${OPEN_BORDER} solid var(--wt-color-primary);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    box-shadow: none;
  }
  /* The box's border replaces a period-ended row's amber edge and its padding; the stripe is drawn
     inside the box instead, so the tick keeps every opened row's inset. */
  :host .order-lines > .entry.draft-row.period-ended-entry[data-open] {
    padding-inline-start: 0;
    box-shadow: inset var(--wt-space-1) 0 0 var(--wt-color-warning);
  }
  :host .order-lines > .entry.draft-row[data-draft-dragging] {
    outline: 2px solid var(--wt-color-primary);
    outline-offset: -2px;
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
    column-gap: 0;
    min-height: var(--wt-tap-min);
    margin: 0;
    padding: var(--wt-space-1) 0;
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
  ${rowTextStyles}
  :host .draft-row > .draft-row-end {
    display: grid;
    grid-column: 3;
    align-self: stretch;
  }
  /* The negative margin takes OPEN_INSET off the column, so an arrow's column ends with the
     closed rows' and an empty one is --wt-space-2 wide. */
  :host .draft-row[data-open] > .draft-row-end {
    min-width: calc(var(--wt-space-2) + ${OPEN_INSET});
    margin-inline-end: calc(-1 * ${OPEN_INSET});
  }
  :host .draft-row > .draft-row-opened {
    display: block;
    grid-column: 1 / -1;
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
    width: var(--wt-tap-min);
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
    border: 2px solid var(--wt-color-text-muted);
    border-radius: calc(var(--wt-radius-sm) * 1.5);
    background: transparent;
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
