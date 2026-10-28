import {
  kitchenAllergyBlock,
  kitchenAllergyMarker,
  kitchenAllergyStyles,
} from "./kitchen-allergy-block.js";
import { groupName } from "./group-name.js";
import { queueCrossRefs } from "./queue-crossrefs.js";
import { optionAnswers } from "./option-snapshot.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TickingClock, baseStyles, registerIcons, visuallyHiddenStyles } from "@waitron/ui";
import { type TimingBand, classifyBand, thousandthsToDecimal } from "@waitron/shared";
import { clockTime, currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { dietBadgeStyles, dietBadges, extraNutrition } from "./diet-badges.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";
import { dishLine, snapshotDescriptionFor, trimQuantity } from "./dish-format.js";
import {
  type CourseSection,
  type KitchenCard,
  type MergedQueueGroup,
  cardPlaces,
  dishesAt,
  headingStage,
  isCounterOrder,
  kitchenCards,
  lateCards,
  overviewDishes,
  thousandthsToMake,
} from "../state/kitchen-cards.js";
import { type OverviewRow, overviewRows, rowsToMake } from "../state/kitchen-overview.js";
import { type ColumnKey, type ColumnState, STATION_COLUMNS } from "../state/kitchen-columns.js";
import {
  type BoardMeasure,
  CARD_COLUMN_TEXT_WIDTHS,
  columnsFit,
} from "../state/kitchen-board-fit.js";
import { PHONE_WIDTH } from "./language-chooser-styles.js";
import { segmentedOptionStyles } from "./segmented-control-styles.js";
import type {
  KitchenNotice,
  KitchenNoticeKind,
  StationQueueGroup,
  StationQueueItem,
  TicketState,
} from "../api/client.js";

/** A diagonal cross: a void notice here, and the till app's `close` icon. */
export const CROSS_ICON_PATH =
  "M3 4.4 4.4 3 8 6.6 11.6 3 13 4.4 9.4 8 13 11.6 11.6 13 8 9.4 4.4 13 3 11.6 6.6 8Z";

const NOTICE_ICONS: Record<`notice-${KitchenNoticeKind}`, string> = {
  "notice-recalled": "M6 2 1.5 6 6 10V7h4a2.5 2.5 0 0 1 0 5H6v2h4a4.5 4.5 0 0 0 0-9H6Z",
  "notice-void": CROSS_ICON_PATH,
  "notice-allergy_changed": "M7 1H9V10H7ZM7 12H9V14H7Z",
  "notice-allergy_removed": CROSS_ICON_PATH,
  "notice-changed": "M11.3 1.9 14.1 4.7 5.8 13H3V10.2ZM2 14.5H14V15.5H2Z",
  "notice-moved": "M2 7H10.6L7.3 3.7 8.7 2.3 14.4 8 8.7 13.7 7.3 12.3 10.6 9H2Z",
  "notice-rerouted": "M2 7H10.6L7.3 3.7 8.7 2.3 14.4 8 8.7 13.7 7.3 12.3 10.6 9H2Z",
};
// Registered here rather than in main.ts: the icons are this widget's, and every surface that mounts it
// needs them.
registerIcons(NOTICE_ICONS);
registerIcons({
  "column-open": "M2 5.4 3.4 4 8 8.6 12.6 4 14 5.4 8 11.4Z",
  "column-closed": "M5.4 2 4 3.4 8.6 8 4 12.6 5.4 14 11.4 8Z",
});

/** `ready` is terminal: a counter order's handover is an order-level collect, not a kitchen state. */
const NEXT: Record<TicketState, Exclude<TicketState, "queued"> | undefined> = {
  queued: "preparing",
  preparing: "ready",
  ready: undefined,
};

/** Kitchen-state order, which a dish's state word compares; the drawn order is {@link TillStationQueue.columns}. */
const COLUMNS: readonly TicketState[] = ["queued", "preparing", "ready"];

const DRAWN: Partial<Record<ColumnKey, TicketState>> = {
  waiting: "queued",
  preparing: "preparing",
  ready: "ready",
};

export type { MergedQueueGroup } from "../state/kitchen-cards.js";

/** The columns this board can draw, each with its name: Overview, then the kitchen states in order. */
export function stationColumnNames(): Map<ColumnKey, string> {
  return new Map([
    ["overview", t("station.overview")],
    ...Object.entries(DRAWN).map(
      ([key, state]) => [key as ColumnKey, t(`station.state.${state}` as const)] as const,
    ),
  ]);
}

function dishCount(thousandths: number): string {
  return trimQuantity(thousandthsToDecimal(thousandths));
}

function afterPeriodWords(period: string): string {
  return t("station.after_period").replace("{period}", () => period);
}

/**
 * One station's ticket items, shown as a board: a column per kitchen state, a card per sent group. A
 * pure view: the container owns {@link groups} and turns the events this emits into API calls.
 *
 * A card is aged by its oldest fired dish, against its own station's thresholds. The age band is a top
 * border, never a text background; a `forgotten` band pulses unless reduced motion is asked for. The
 * minutes on each card and the header's late count say it without colour.
 */
@customElement("till-station-queue")
export class TillStationQueue extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    dietBadgeStyles,
    kitchenAllergyStyles,
    orderNumberStyles,
    segmentedOptionStyles,
    css`
      :host {
        display: block;
      }

      .width-probe {
        height: 0;
      }

      .column-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3) var(--wt-space-2);
        margin-block-end: var(--wt-space-3);
      }

      .tab-panel {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .kanban {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: var(--wt-space-3);
      }

      .column {
        display: flex;
        flex: 1 1 11rem;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 0;
      }

      .column-overview {
        flex-grow: 0;
      }

      .column.collapsed {
        flex: 0 0 var(--wt-tap-min);
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

      /* A tab panel spans the board, so a name would sit across the screen from its count. */
      .tab-panel .overview {
        max-width: calc(${unsafeCSS(CARD_COLUMN_TEXT_WIDTHS)} * var(--wt-font-size-md));
      }

      @media ${unsafeCSS(PHONE_WIDTH)} {
        .tab-panel .overview {
          max-width: none;
        }
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

      .column-tab[data-late] {
        box-shadow: 0 var(--wt-space-1) 0 var(--wt-color-danger);
      }

      .column:not(.collapsed) .column-count {
        margin-inline-start: auto;
      }

      .ticket {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 12rem;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-top: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .kitchen-note {
        margin: 0;
        padding: var(--wt-space-2);
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        overflow-wrap: anywhere;
      }

      .ticket-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        border: none;
        border-bottom: 1px solid var(--wt-color-border);
      }

      button.ticket-head {
        width: 100%;
        margin: 0;
        padding: 0;
        background: none;
        color: var(--wt-color-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .label {
        color: var(--wt-color-text);
      }

      .age {
        margin-left: auto;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .lines {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .elsewhere {
        border-top: 1px solid var(--wt-color-border);
        padding-top: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .elsewhere-head {
        margin: 0 0 var(--wt-space-2);
        font-size: inherit;
        font-weight: var(--wt-font-weight-bold);
      }

      .elsewhere-lines {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .elsewhere-lines li {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1) var(--wt-space-2);
      }

      /* A line cell — the tappable bump target (a plain button so it themes like the floor cards). A
         ready-tail cell renders the same box as a non-interactive span (.line.terminal). Column layout so
         the dish row (.line-main) can carry an indented modifiers list beneath it. */
      .line {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-1);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: left;
      }

      /* A button sizes to its content, not its container. */
      .lines .line {
        width: 100%;
      }

      button.line {
        cursor: pointer;
      }

      .movable {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-1);
        margin-bottom: var(--wt-space-1);
      }

      /* The dish row: qty× name. */
      .line-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
      }

      /* The dish's selected options, indented beneath it — matching the
         kitchen-print ticket's own "+ name" sub-text style (apps/server/src/kitchen-ticket.ts). Muted
         text, never a tap target of its own (removing an option removes the whole dish). */
      .line-modifiers {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding-left: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .line-crossrefs {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Each selected extra's OWN allergens/diet (nutrition redesign, pass 1), flowing inline after the
         extra's "+ name" — never a fold, just the extra's own list beside the dish's own rows below. */
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

      /* The per-line kitchen customisation (order-line customisation, Task 5), indented beneath the dish
         like the modifiers list: the free-text note as muted sub-text. */
      .line-customisation {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      .line-note {
        color: var(--wt-color-text-muted);
      }

      /* The dish's OWN allergen profile (modifier↔allergen), indented beneath the dish + modifiers:
         localised "contains" chips. A flex-wrap row (chips flow), the same indent as
         the modifiers list. */
      .line-allergens {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .allergen-label {
        font-weight: var(--wt-font-weight-bold);
      }

      .allergen-chip {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full, 999px);
      }

      /* The as-served DIET & contains row (dietary-classification, Task 7), indented like the allergen
         row beneath the dish. The badge/chip look comes from the shared dietBadgeStyles; only the indent
         is station-specific. */
      .line-diet {
        padding-left: var(--wt-space-3);
      }

      .line.state-queued {
        border-left-color: var(--wt-color-text-muted);
      }

      .line.state-preparing {
        border-left-color: var(--wt-color-primary);
      }

      .line.state-ready {
        border-left-color: var(--wt-color-success);
      }

      /* A HELD line — greyed and non-advanceable. Greying is a
         MUTED text colour (the token every secondary label uses, so it keeps a11y contrast on the
         surface) plus a dashed box, NOT reduced opacity (which would composite the text against the
         background and fail the color-contrast sweep). It renders as an inert span, so there is no bump. */
      .line.held {
        border-style: dashed;
        border-left-style: solid;
        color: var(--wt-color-text-muted);
      }

      /* The dish label (qty × name) — the primary text a cook reads. Truncates rather than wrapping so
         a long name never blows out the cell/line width (min-width:0 lets a flex child shrink). */
      .line-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .line-move {
        overflow-wrap: anywhere;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .line-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .line-station,
      .notice-station {
        display: block;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The age band along the card's top, never behind text (D7). */
      .ticket.age-fresh {
        border-top-color: var(--wt-color-success);
      }

      .ticket.age-warm {
        border-top-color: var(--wt-color-warning);
      }

      .ticket.age-overdue,
      .ticket.age-forgotten {
        border-color: var(--wt-color-danger);
      }

      /* A board card in a column fills it. */
      .column .ticket {
        min-width: 0;
      }

      /* Every dish held: dashed, as a held line is, with no age band. */
      .ticket.held {
        border-style: dashed;
      }

      /* .flash is set only while reduced motion is not asked for; the @media rule also stops a card
         drawn before the preference changed. */
      .ticket.age-forgotten.flash {
        animation: age-forgotten-flash var(--wt-duration-pulse-fast) ease-in-out infinite;
      }

      @keyframes age-forgotten-flash {
        50% {
          border-color: var(--wt-color-danger-pulse-dim);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ticket.age-forgotten.flash {
          animation: none;
        }
      }

      .board-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-2);
      }

      .board-head [data-columns-open] {
        margin-inline-start: auto;
      }

      .kitchen-counts {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .course {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .course-head {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }

      .held-note {
        font-weight: var(--wt-font-weight-normal);
        text-transform: none;
      }

      /* Warning chips — the printing-problem tell and the late-send mark — words first so neither rests on colour. */
      .print-problem,
      .after-period {
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .print-problem {
        align-self: flex-start;
        margin: 0;
      }

      .whole-ticket {
        display: inline-block;
        align-self: flex-start;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .collect {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-primary);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }

      wt-button.reprint {
        display: block;
      }
      /* The notices strip: corrections to work a station already has, each until a cook acknowledges
         it. The kind is always text plus an icon; the left border only repeats it. */
      .notices {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-4);
      }

      .notices-title {
        margin: 0;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }

      .notice-list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .notice {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .notice.kind-void {
        border-left-color: var(--wt-color-danger);
      }

      .notice-kind {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }

      .notice-body {
        display: flex;
        flex: 1 1 auto;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-1) var(--wt-space-3);
        min-width: 0;
      }

      .notice-line {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      /* A grid, so the text asks for its widest dish's width, not every dish's added up. */
      .notice-dishes {
        display: grid;
        flex-basis: 100%;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .notice-dish {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-1) var(--wt-space-3);
        min-width: 0;
      }

      .notice-moved,
      .notice-rerouted,
      .notice-note {
        overflow-wrap: anywhere;
      }

      .notice-extra,
      .notice-station {
        flex-basis: 100%;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      /* Emphasis by weight and a border, so "started" never rests on colour. */
      .notice-started {
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-danger);
        border-radius: var(--wt-radius-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }

      .notice wt-button {
        margin-inline-start: auto;
      }
    `,
  ];

  @property({ attribute: false }) groups: MergedQueueGroup[] = [];
  /** Unacknowledged corrections for this station, oldest first as the server sends them. */
  @property({ attribute: false }) notices: KitchenNotice[] = [];
  /** The station these items are AT; a bump without one (its own or its group's) sends nothing. */
  @property() stationId?: string;
  /** Set for a merged queue: each dish and notice is labelled with its station's name. */
  @property({ attribute: false }) stationNames?: ReadonlyMap<string, string>;
  /** For an enrolled device display: collection needs a session, so its button is hidden. */
  @property({ type: Boolean }) advanceOnly = false;
  @property({ type: Boolean }) showReprint = false;
  @property({ type: Boolean }) canMove = false;
  /** Injectable clock for age colouring. Set in tests for deterministic bands. */
  @property({ attribute: false }) now?: number;
  @property({ attribute: false }) reducedMotion?: boolean;
  /** The device's layout, owned by the screen: a heading tap only asks, through `toggle-column`. */
  @property({ attribute: false }) columns: ColumnState = STATION_COLUMNS;

  /** Re-renders while the display sits idle, so a ticket can climb fresh → warm → overdue → forgotten
   *  between the container's own refreshes. */
  readonly #clock = new TickingClock(this);

  /** The host's width and sizes, read before each drawing so the first is already tabs or columns. */
  #measured?: BoardMeasure;
  #resizing?: ResizeObserver;
  @state() private chosenTab?: ColumnKey;
  /** A collapsed column whose heading was just tapped: chosen if opening it turns the board to tabs. */
  #opening?: ColumnKey;
  /** The tab that takes the focus from the heading its column was opened with, which the tabs remove. */
  #focusTab?: ColumnKey;
  #drewTabs = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#observeWidth();
  }

  override firstUpdated(): void {
    this.#observeWidth();
  }

  /** Watches a line of no height across the board, not the host: the switch to tabs changes the
   * host's height, which a watch on the host would report again in the same frame. */
  #observeWidth(): void {
    this.#resizing = new ResizeObserver((entries) => {
      if (entries.at(-1)!.contentRect.width !== this.#measured?.width) this.requestUpdate();
    });
    this.#resizing.observe(this.renderRoot.querySelector(".width-probe")!);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resizing?.disconnect();
    this.#resizing = undefined;
  }

  override willUpdate(): void {
    const own = getComputedStyle(this);
    const px = (token: string) => parseFloat(own.getPropertyValue(token));
    this.#measured = {
      width: this.getBoundingClientRect().width,
      textPx: parseFloat(own.fontSize),
      remPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
      tapMinPx: px("--wt-tap-min"),
      gapPx: px("--wt-space-3"),
    };
    const tabs = this.groups.length > 0 && !this.#fits();
    if (this.#opening !== undefined && tabs && !this.#drewTabs) {
      this.chosenTab = this.#opening;
      const focused = (this.renderRoot as ShadowRoot).activeElement;
      if (focused instanceof HTMLElement && focused.dataset.columnToggle === this.#opening) {
        this.#focusTab = this.#opening;
      }
    }
    this.#opening = undefined;
    this.#drewTabs = tabs;
    const shown = this.#shown();
    if (tabs && this.chosenTab !== undefined && !shown.includes(this.chosenTab)) {
      this.chosenTab = shown[0]!;
    }
  }

  override updated(): void {
    if (this.#focusTab === undefined) return;
    this.renderRoot.querySelector<HTMLElement>(`[data-column-tab="${this.#focusTab}"]`)!.focus();
    this.#focusTab = undefined;
  }

  /** The columns this board can draw that are not hidden, in the layout's order. */
  #shown(): ColumnKey[] {
    return this.columns.order.filter(
      (key) =>
        (key === "overview" || DRAWN[key] !== undefined) && !this.columns.hidden.includes(key),
    );
  }

  #fits(): boolean {
    return (
      this.#measured === undefined ||
      columnsFit(this.#measured, this.#shown(), this.columns.collapsed)
    );
  }

  /** `members`: the row's portions, its first the one drawn; a grouped row moves them all. */
  #bump(
    card: KitchenCard,
    group: MergedQueueGroup,
    members: readonly StationQueueItem[],
    to: Exclude<TicketState, "queued">,
  ): void {
    const stationId = group.stationId ?? this.stationId;
    if (stationId === undefined) return;
    const [item] = members as [StationQueueItem, ...StationQueueItem[]];
    if (group.bumpMode === "ticket") {
      this.#advanceDishes(dishesAt(card, item.state), stationId, to);
    } else if (members.length > 1) {
      this.#advanceDishes(
        members.map((member) => member.id),
        stationId,
        to,
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: item.id, stationId, to },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** Moves only the dishes holding the card back, so the card moves one column (D8). */
  #advanceHeading(card: KitchenCard, stage: TicketState): void {
    const [first] = card.orders as [MergedQueueGroup, ...MergedQueueGroup[]];
    const stationId = first.stationId ?? this.stationId;
    const to = NEXT[stage];
    if (stationId === undefined || to === undefined) return;
    this.#advanceDishes(dishesAt(card, stage), stationId, to);
  }

  #advanceDishes(itemIds: string[], stationId: string, to: Exclude<TicketState, "queued">): void {
    this.dispatchEvent(
      new CustomEvent("advance-dishes", {
        detail: { itemIds, stationId, to },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #collect(group: StationQueueGroup): void {
    this.dispatchEvent(
      new CustomEvent("mark-collected", {
        detail: { orderId: group.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #move(group: MergedQueueGroup, members: readonly StationQueueItem[]): void {
    const [item] = members as [StationQueueItem, ...StationQueueItem[]];
    this.dispatchEvent(
      new CustomEvent("move-station", {
        detail: {
          workingOrderId: group.orderId,
          lineId: item.workingOrderLineId,
          ...(members.length > 1
            ? { lineIds: members.map((member) => member.workingOrderLineId) }
            : {}),
          name: item.name,
          stationId: group.stationId ?? this.stationId,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #reprint(group: StationQueueGroup): void {
    this.dispatchEvent(
      new CustomEvent("reprint-order", {
        detail: { orderId: group.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Never a fresh `Date.now()` call, so every render in one tick sees the identical `now`. */
  #clockNow(): number {
    return this.now ?? this.#clock.now;
  }

  #elapsedMinutes(since: number): number {
    return Math.max(0, Math.floor((this.#clockNow() - since) / 60000));
  }

  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #accentClasses(band: TimingBand): string {
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return `age-${band}${flash ? " flash" : ""}`;
  }

  /** "5 dishes to make · 1 late", over every card on this queue (D9). */
  #header(cards: readonly KitchenCard[]): TemplateResult | typeof nothing {
    const toMake = thousandthsToMake(cards);
    const late = lateCards(cards, this.#clockNow());
    if (toMake === 0 && late === 0) return nothing;
    const dishes =
      toMake === 1000
        ? t("station.to_make_one")
        : t("station.to_make").replace("{n}", trimQuantity(thousandthsToDecimal(toMake)));
    const lateWords = late === 0 ? "" : ` · ${t("station.late").replace("{n}", String(late))}`;
    return html`<p class="kitchen-counts" data-kitchen-counts>${dishes}${lateWords}</p>`;
  }

  override render() {
    const cards = kitchenCards(this.groups);
    return html`<div class="width-probe"></div>
      <div class="board-head" data-board-head>
        <slot name="lead"></slot>${this.#header(cards)}<wt-button
          data-columns-open
          variant="secondary"
          @click=${(event: Event) => this.#openColumns(event.currentTarget as HTMLElement)}
          >${t("station.columns")}</wt-button
        >
      </div>
      <slot name="status"></slot>${this.#notices()}${
        this.groups.length === 0
          ? html`<p class="empty">${t("station.empty")}</p>`
          : this.#fits()
            ? this.#board(cards)
            : this.#tabs(cards)
      }`;
  }

  #openColumns(opener: HTMLElement): void {
    this.dispatchEvent(
      new CustomEvent("open-columns", { detail: { opener }, bubbles: true, composed: true }),
    );
  }

  #notices(): TemplateResult | typeof nothing {
    if (this.notices.length === 0) return nothing;
    return html`<section class="notices" aria-labelledby="notices-title">
      <h2 class="notices-title" id="notices-title">${t("station.notices")}</h2>
      <ul class="notice-list">
        ${this.notices.map((notice) => this.#notice(notice))}
      </ul>
    </section>`;
  }

  #notice(notice: KitchenNotice): TemplateResult {
    const change = notice.orderNoteChange;
    const kind =
      change === undefined
        ? t(`station.notice.${notice.kind}` as const)
        : t(change.after === null ? "kitchen_note.removed" : "kitchen_note.changed");
    const sign = notice.direction === null ? "" : notice.direction === "added" ? "+" : "\u2212";
    const dishes = notice.dishes;
    const line =
      dishes === undefined
        ? `${sign}${dishLine(notice, notice.lineName)}`
        : dishes.map((dish) => dishLine(dish, dish.lineName)).join(", ");
    const started = html`<span class="notice-started">${t("station.notice.started")}</span>`;
    const acknowledge = t("station.notice.acknowledge");
    const { movedTo, reroutedTo, cancelledExtra } = notice;
    // Replacer functions, so a `$` in a name is never read as a pattern.
    const extra =
      cancelledExtra === null
        ? null
        : t("station.notice.cancelled_extra").replace("{extra}", () => cancelledExtra);
    const rerouted =
      reroutedTo === null
        ? null
        : t("station.notice.rerouted_to").replace("{station}", () => reroutedTo);
    const moved =
      notice.kind !== "moved"
        ? null
        : movedTo === null
          ? t("station.notice.moved_to_counter")
          : t("station.notice.moved_to").replace("{table}", () => movedTo);
    const station = this.stationNames?.get(notice.stationId);
    return html`<li class="notice kind-${notice.kind}" data-notice=${notice.id}>
      <span class="notice-kind"><wt-icon name=${`notice-${notice.kind}`}></wt-icon>${kind}</span>
      <span class="notice-body">
        ${
          dishes === undefined
            ? html`<span class="notice-line">${line}</span>`
            : html`<span class="notice-dishes">
                ${dishes.map(
                  (dish) =>
                    html`<span class="notice-dish" data-notice-dish>
                      <span class="notice-line">${dishLine(dish, dish.lineName)}</span>
                      ${dish.wasStarted ? started : nothing}
                      ${dish.note ? html`<span class="notice-note">${dish.note}</span>` : nothing}
                    </span>`,
                )}
              </span>`
        }
        ${extra === null ? nothing : html`<span class="notice-extra">${extra}</span>`}
        <span class="notice-order">${notice.orderLabel}</span>
        ${dishes === undefined && notice.wasStarted ? started : nothing}
        ${
          change === undefined
            ? nothing
            : html`
                ${change.before === null ? nothing : html`<span class="notice-note">${t("kitchen_note.before")}: ${change.before}</span>`}
                ${change.after === null ? nothing : html`<span class="notice-note">${t("kitchen_note.after")}: ${change.after}</span>`}
              `
        }
        ${notice.kind === "allergy_changed" ? kitchenAllergyBlock(notice.allergyBlock!) : nothing}
        ${dishes === undefined && notice.note ? html`<span class="notice-note">${notice.note}</span>` : nothing}
        ${moved === null ? nothing : html`<span class="notice-moved">${moved}</span>`}
        ${rerouted === null ? nothing : html`<span class="notice-rerouted">${rerouted}</span>`}
        ${
          station === undefined
            ? nothing
            : html`<span class="notice-station" data-notice-station>${station}</span>`
        }
      </span>
      <wt-button
        data-acknowledge
        variant="secondary"
        aria-label=${`${acknowledge}: ${kind} ${line}, ${extra === null ? "" : `${extra}, `}${notice.orderLabel}${rerouted === null ? "" : `, ${rerouted}`}`}
        @click=${() => this.#acknowledge(notice)}
      >
        ${acknowledge}
      </wt-button>
    </li>`;
  }

  #acknowledge(notice: KitchenNotice): void {
    this.dispatchEvent(
      new CustomEvent("acknowledge-notice", {
        detail: { noticeId: notice.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #elsewhere(group: StationQueueGroup, tag: string): TemplateResult | typeof nothing {
    if (!group.elsewhere?.length) return nothing;
    return html`<section class="elsewhere" data-elsewhere=${group.orderId}>
      <h3 class="elsewhere-head">${t("station.elsewhere")}${tag}</h3>
      <ul class="elsewhere-lines">
        ${group.elsewhere.map(
          (item) =>
            html`<li data-elsewhere-item=${item.id}>
              <span class="elsewhere-name">${dishLine(item, item.name)}</span>
              <span class="elsewhere-station">${item.stationName}</span>
              <span class="elsewhere-state"
                >${item.held ? t("station.elsewhere_held") : t(`station.state.${item.state}` as const)}</span
              >
            </li>`,
        )}
      </ul>
    </section>`;
  }

  #courseSection(
    section: CourseSection,
    row: (members: StationQueueItem[]) => TemplateResult,
    headed: boolean,
  ): TemplateResult {
    return html`<div class="course" data-course=${section.course?.id ?? "none"}>
      ${headed && section.course ? html`<div class="course-head">${section.course.name}</div>` : nothing}
      <ul class="lines">
        ${this.#sectionLines(section.rows, row)}
      </ul>
    </div>`;
  }

  /** A mark row goes above each run of consecutive lines agreed after the same period, within one head. */
  #sectionLines(
    rows: readonly StationQueueItem[][],
    row: (members: StationQueueItem[]) => TemplateResult,
  ): TemplateResult[] {
    return rows.map((members, index) => {
      const period = members[0]!.afterPeriod;
      const mark =
        period !== undefined && rows[index - 1]?.[0]!.afterPeriod !== period
          ? html`<li class="after-period" data-after-period>${afterPeriodWords(period)}</li>`
          : nothing;
      return html`${mark}
        <li>${row(members)}</li>`;
    });
  }

  /** Collect is offered on settled orders only; a sent, unpaid counter order is handed over from the
   * counter's waiting list instead. */
  #collectAction(group: StationQueueGroup, tag: string): TemplateResult | typeof nothing {
    if (this.advanceOnly) return nothing;
    if (group.status !== "settled") return nothing;
    return html`<button
      class="collect"
      data-collect=${group.orderId}
      aria-label=${`${t("station.collect")} #${group.orderNumber}`}
      @click=${() => this.#collect(group)}
    >
      ${t("station.collect")}${tag}
    </button>`;
  }

  /** Its accessible name is the slotted text: on a one-bill card the heading gives the bill, so no
   * `aria-label` is added. */
  #reprintAction(group: StationQueueGroup, tag: string): TemplateResult | typeof nothing {
    if (!this.showReprint) return nothing;
    return html`<wt-button
      class="reprint"
      data-reprint=${group.orderId}
      variant="secondary"
      @click=${() => this.#reprint(group)}
    >
      ${t("station.reprint")}${tag}
    </wt-button>`;
  }

  #toggleColumn(key: ColumnKey): void {
    if (this.columns.collapsed.includes(key)) this.#opening = key;
    this.dispatchEvent(
      new CustomEvent("toggle-column", { detail: { key }, bubbles: true, composed: true }),
    );
  }

  /** One column at a time, under a tab per shown column; a collapsed column opens in its tab. */
  #tabs(cards: readonly KitchenCard[]): TemplateResult {
    const shown = this.#shown();
    const chosen =
      this.chosenTab !== undefined && shown.includes(this.chosenTab) ? this.chosenTab : shown[0]!;
    const rows = overviewRows(overviewDishes(cards));
    const inColumn = (state: TicketState) => cards.filter((card) => card.column === state);
    const now = this.#clockNow();
    const chosenState = DRAWN[chosen];
    return html`<div
        class="column-tabs"
        data-column-tabs
        role="group"
        aria-label=${t("station.columns")}
      >
        ${shown.map((key) => {
          const state = DRAWN[key];
          const title =
            state === undefined ? t("station.overview") : t(`station.state.${state}` as const);
          const count = state === undefined ? rowsToMake(rows) : inColumn(state).length;
          const late = state === undefined ? 0 : lateCards(inColumn(state), now);
          return html`<button
            type="button"
            class="option column-tab"
            data-column-tab=${key}
            ?data-late=${late > 0}
            aria-pressed=${key === chosen ? "true" : "false"}
            @click=${() => (this.chosenTab = key)}
          >
            ${title}<span aria-hidden="true"> ·</span>
            <span aria-hidden=${late > 0 ? "true" : nothing}>${count}</span>${this.#lateWords(
              count,
              late,
            )}
          </button>`;
        })}
      </div>
      <section class="tab-panel" data-tab-panel=${chosen} data-column=${chosenState ?? "overview"}>
        ${
          chosenState === undefined
            ? this.#overview(rows)
            : inColumn(chosenState).map((card) => this.#card(card))
        }
      </section>`;
  }

  #board(cards: readonly KitchenCard[]): TemplateResult {
    const shown = this.#shown();
    return html`<div class="kanban">
      ${shown.map((key) => {
        const collapsed = this.columns.collapsed.includes(key);
        const state = DRAWN[key];
        if (state === undefined) {
          const rows = overviewRows(overviewDishes(cards));
          return html`<section
            class="column column-overview ${collapsed ? "collapsed" : ""}"
            data-column="overview"
          >
            ${this.#heading(key, t("station.overview"), rowsToMake(rows), collapsed)}
            ${collapsed ? nothing : this.#overview(rows)}
          </section>`;
        }
        const inColumn = cards.filter((card) => card.column === state);
        const late = collapsed ? lateCards(inColumn, this.#clockNow()) : 0;
        return html`<section
          class="column column-${state} ${collapsed ? "collapsed" : ""}"
          data-column=${state}
        >
          ${this.#heading(
            key,
            t(`station.state.${state}` as const),
            inColumn.length,
            collapsed,
            late,
          )}
          ${collapsed ? nothing : inColumn.map((card) => this.#card(card))}
        </section>`;
      })}
    </div>`;
  }

  /** One button template for both states, so a redraw keeps the focused element. */
  #heading(
    key: ColumnKey,
    title: string,
    count: number,
    collapsed: boolean,
    late = 0,
  ): TemplateResult {
    return html`<h2 class="column-heading">
      <button
        class="column-toggle"
        data-column-toggle=${key}
        ?data-late=${late > 0}
        aria-expanded=${collapsed ? "false" : "true"}
        @click=${() => this.#toggleColumn(key)}
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
        >${this.#lateWords(count, late)}${collapsed ? nothing : html`<wt-icon name="column-open" aria-hidden="true"></wt-icon>`}
      </button>
    </h2>`;
  }

  /** The count's words while late: "1, 1 late" in one hidden span, as the drawn count is hidden
   * then; a hidden span after the drawn count puts a space before its comma in Chromium's name. */
  #lateWords(count: number, late: number): TemplateResult | typeof nothing {
    if (late === 0) return nothing;
    return html`<span class="visually-hidden"
      >${count}, ${t("station.late").replace("{n}", String(late))}</span
    >`;
  }

  #overview(rows: readonly OverviewRow[]): TemplateResult {
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

  /** A card with no fired dish is held: dashed, untimed and saying so, whatever its group (D3). */
  #card(card: KitchenCard): TemplateResult {
    const [first] = card.orders as [MergedQueueGroup, ...MergedQueueGroup[]];
    const { since, group } = card;
    // Every bill on one card is one station's, so the first carries its thresholds.
    const accent =
      since === null
        ? "held"
        : this.#accentClasses(classifyBand(since, this.#clockNow(), first.thresholds));
    const labels = cardPlaces(card);
    const row = (members: StationQueueItem[]) =>
      this.#renderLine(
        card,
        card.orderOf.get(members[0]!.id)!,
        members,
        this.#stateWord(card, members[0]!),
      );
    const { sections } = card;
    // One shared course is named in the heading; its dishes keep their `.course` wrapper (D5).
    const sharedCourse = sections.length === 1 ? sections[0]!.course : null;
    // On a card merging bills, each bill's facts and actions name their bill (D11).
    const tag = (order: StationQueueGroup) =>
      card.orders.length === 1 ? "" : ` #${order.orderNumber}`;
    const stage = headingStage(card);
    const head = html`${card.orders.map(
      (order, index) =>
        html`${index === 0 ? nothing : " · "}${
            isCounterOrder(order)
              ? html`<span class="counter">${t("station.counter")}</span> `
              : nothing
          }<span class="number">${orderNumber(order.orderNumber, order.formerNumbers)}</span>`,
    )}
    ${kitchenAllergyMarker(card.items.some((item) => item.allergy !== null))}
    ${labels.map((label) => html`<span class="label">${label}</span>`)}
    ${group === null ? nothing : html`<span class="group-name">${groupName(group)}</span>`}
    ${sharedCourse === null ? nothing : html`<span class="course-name">${sharedCourse.name}</span>`}
    ${
      group?.state === "held" || since === null
        ? html`<span class="held-note" data-group-held>${t("station.group_held")}</span>`
        : nothing
    }
    ${
      since === null
        ? nothing
        : html`<span class="age">${this.#elapsedMinutes(since)} ${t("station.min")}</span>`
    }`;
    return html`<article
      class="ticket ${accent}"
      data-card=${card.key}
      data-order=${first.orderNumber}
      data-card-group=${group?.id ?? "none"}
    >
      ${
        stage === undefined
          ? html`<div class="ticket-head">${head}</div>`
          : html`<button
              class="ticket-head"
              data-card-head
              @click=${() => this.#advanceHeading(card, stage)}
            >
              ${head}<span class="visually-hidden"
                >${t("station.bump_ticket")} #${first.orderNumber}</span
              >
            </button>`
      }
      ${stage === undefined ? nothing : this.#wholeTicket(first)}
      ${card.orders.map((order) => this.#kitchenNote(order, tag(order)))}
      ${card.orders.map((order) => this.#printProblem(order, tag(order)))}
      ${sections.map((section) => this.#courseSection(section, row, sections.length > 1))}
      ${card.orders.map((order) => this.#elsewhere(order, tag(order)))}
      ${card.orders.map((order) => this.#collectAction(order, tag(order)))}
      ${card.orders.map((order) => this.#reprintAction(order, tag(order)))}
    </article>`;
  }

  #kitchenNote(group: StationQueueGroup, tag: string): TemplateResult | typeof nothing {
    return group.kitchenNote
      ? html`<p class="kitchen-note" data-kitchen-note>
          ${t("kitchen_note.heading")}${tag}: ${group.kitchenNote}
        </p>`
      : nothing;
  }

  #printProblem(group: StationQueueGroup, tag: string): TemplateResult | typeof nothing {
    return group.printProblem
      ? html`<p class="print-problem" data-print-problem>${t("station.print_problem")}${tag}</p>`
      : nothing;
  }

  #wholeTicket(group: StationQueueGroup): TemplateResult | typeof nothing {
    if (group.bumpMode !== "ticket") return nothing;
    return html`<span class="whole-ticket" data-whole-ticket>${t("station.whole_ticket")}</span>`;
  }

  /** A dish at its card's column says nothing, the column does; one further on says its state, and a
   * held dish on a card that is not itself held says so (D12). */
  #stateWord(card: KitchenCard, item: StationQueueItem): TemplateResult | typeof nothing {
    let word: string | undefined;
    if (item.firedAt === null) {
      if (card.since !== null) word = t("station.group_held");
    } else if (COLUMNS.indexOf(item.state) > COLUMNS.indexOf(card.column)) {
      word = t(`station.state.${item.state}` as const);
    }
    return word === undefined ? nothing : html`<span class="line-state">${word}</span>`;
  }

  /** `members`: identical portions drawn as one row from its first (spec §3.1). */
  #renderLine(
    card: KitchenCard,
    group: MergedQueueGroup,
    members: StationQueueItem[],
    state: TemplateResult | typeof nothing,
  ): TemplateResult {
    const [item] = members as [StationQueueItem, ...StationQueueItem[]];
    const station =
      group.stationId === undefined ? undefined : this.stationNames?.get(group.stationId);
    const main = html`<span class="line-main">
        <span class="line-name">${this.#dish(item, members.length)}</span>${state} </span
      >${
        station === undefined
          ? nothing
          : html`<span class="line-station" data-line-station>${station}</span>`
      }`;
    const move = item.lastMove;
    const attribution =
      move === undefined
        ? nothing
        : html`<span class="line-move" data-last-move
            >${[
              t("station.moved_from").replace("{station}", () => move.fromStationName),
              move.personName,
              move.deviceName,
              clockTime(new Date(move.movedAt)),
            ]
              .filter((part) => part !== null)
              .join(" · ")}</span
          >`;
    const customisation = this.#customisation(item);
    const modifiers = this.#modifiers(item);
    const crossRefs = queueCrossRefs(item, "line");
    const allergens = this.#allergens(item);
    const allergy = kitchenAllergyBlock(item.allergy);
    const diet = dietBadges(item.asServedDiet, `line-diet-${item.id}`);
    const held = item.firedAt === null;
    const next = NEXT[item.state];
    const line =
      held || next === undefined
        ? html`<span
            class="line state-${item.state} ${held ? "held" : "terminal"}"
            data-item=${item.id}
            >${main}${attribution}${customisation}${modifiers}${crossRefs}${allergens}${diet}${allergy}</span
          >`
        : html`<button
            class="line state-${item.state}"
            data-item=${item.id}
            @click=${() => this.#bump(card, group, members, next)}
          >
            ${main}${attribution}${customisation}${modifiers}${crossRefs}${allergens}${diet}${allergy}
            <span class="visually-hidden">${this.#bumpLabel(group)}</span>
          </button>`;
    if (!this.#movable(item)) return line;
    return html`<div class="movable">
      ${line}
      <wt-button
        size="sm"
        variant="secondary"
        data-move-station=${item.id}
        aria-label=${`${t("table.move_station")} · ${item.name}`}
        @click=${() => this.#move(group, members)}
        >${t("table.move_station")}</wt-button
      >
    </div>`;
  }

  /** An extra prepared at its own station is its own queue item, marked only by its "for" cross
   *  reference; like the till, only a dish moves. */
  #movable(item: StationQueueItem): boolean {
    return (
      this.canMove &&
      item.state === "queued" &&
      !(item.crossRefs ?? []).some((ref) => ref.kind === "for")
    );
  }

  #customisation(item: StationQueueItem): TemplateResult | typeof nothing {
    const note = item.note ?? null;
    if (note === null || note === "") return nothing;
    return html`<span class="line-customisation" data-item-customisation=${item.id}>
      <span class="line-note" data-note>${note}</span>
    </span>`;
  }

  /** A `pending` profile shows a "not reviewed" warning: a cook must never read an unverified plate as
   *  allergen-free. Each extra's own allergens are shown separately. */
  #allergens(item: StationQueueItem): TemplateResult | typeof nothing {
    const asServed = item.asServed;
    const codes = asServed ? Object.keys(asServed.allergens).sort() : [];
    if (codes.length === 0) return nothing;
    const locale = currentLocale();
    return html`<span class="line-allergens" data-item-allergens=${item.id}>
      ${
        codes.length > 0
          ? html`<span class="allergen-label">${t("allergens.contains")}</span> ${codes.map(
                (code) => html`<span class="allergen-chip">${allergenName(code, locale)}</span>`,
              )}`
          : nothing
      }
    </span>`;
  }

  /** A cook reads the KITCHEN wording of an answer, which carries no per-language text and so needs
   *  no locale; an extra's own name is still a locale map. */
  #modifiers(item: StationQueueItem): TemplateResult | typeof nothing {
    const modifiers = item.modifiers ?? [];
    const answers = optionAnswers(item.optionSnapshots, { reads: "kitchen" });
    if (modifiers.length === 0 && answers.length === 0) return nothing;
    return html`<span class="line-modifiers">
      ${answers.map((answer) => html`<span class="modifier-answer">${answer}</span>`)}
      ${modifiers.map(
        (modifier, i) =>
          html`<span class="modifier"
            >${`+ ${snapshotDescriptionFor(modifier.descriptions, "")}`}${extraNutrition(
              modifier,
              `item-modifier-allergens-${item.id}-${i}`,
              `item-modifier-diet-${item.id}-${i}`,
            )}</span
          >`,
      )}
    </span>`;
  }

  /** The name is the server-resolved kitchen label and is rendered as sent. */
  #dish(item: StationQueueItem, portions: number): string {
    return dishLine(portions === 1 ? item : { ...item, quantity: String(portions) }, item.name);
  }

  #bumpLabel(group: StationQueueGroup): string {
    const verb = group.bumpMode === "ticket" ? t("station.bump_ticket") : t("station.advance");
    return `${verb} #${group.orderNumber}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-station-queue": TillStationQueue;
  }
}
