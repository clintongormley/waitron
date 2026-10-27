import {
  kitchenAllergyBlock,
  kitchenAllergyMarker,
  kitchenAllergyStyles,
} from "./kitchen-allergy-block.js";
import { groupName } from "./group-name.js";
import { queueCrossRefs } from "./queue-crossrefs.js";
import { optionAnswers } from "./option-snapshot.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { TickingClock, baseStyles, registerIcons, visuallyHiddenStyles } from "@waitron/ui";
import { type TimingBand, classifyBand, thousandthsToDecimal } from "@waitron/shared";
import { clockTime, currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { dietBadgeStyles, dietBadges, extraNutrition } from "./diet-badges.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";
import { dishLine, snapshotDescriptionFor, trimQuantity } from "./dish-format.js";
import {
  type KitchenCard,
  type MergedQueueGroup,
  dishesAt,
  headingStage,
  kitchenCards,
  lateCards,
  thousandthsToMake,
} from "../state/kitchen-cards.js";
import type {
  KitchenNotice,
  KitchenNoticeKind,
  StationQueueCourse,
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

/** `ready` is terminal: a counter order's handover is an order-level collect, not a kitchen state. */
const NEXT: Record<TicketState, Exclude<TicketState, "queued"> | undefined> = {
  queued: "preparing",
  preparing: "ready",
  ready: undefined,
};

const COLUMNS: readonly TicketState[] = ["queued", "preparing", "ready"];

interface CourseSection {
  course: StationQueueCourse | null;
  items: StationQueueItem[];
}

export type { MergedQueueGroup } from "../state/kitchen-cards.js";

/** Courseless lines sort first: the server fires them at once unless the send asks to hold them. */
function courseOrder(course: StationQueueCourse | null): number {
  return course === null ? Number.NEGATIVE_INFINITY : course.displayOrder;
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
    css`
      :host {
        display: block;
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
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
        gap: var(--wt-space-3);
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 0;
      }

      .column-title {
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
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

      /* A HELD line (its course not yet fired, KDS-2 §5a) — greyed and non-advanceable. Greying is a
         MUTED text colour (the token every secondary label uses, so it keeps a11y contrast on the
         surface) plus a dashed box, NOT reduced opacity (which would composite the text against the
         background and fail the color-contrast sweep). It renders as an inert span, so there is no bump. */
      .line.held {
        border-style: dashed;
        border-top-style: solid;
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

      .kitchen-counts {
        margin: 0 0 var(--wt-space-2);
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

  /** Re-renders while the display sits idle, so a ticket can climb fresh → warm → overdue → forgotten
   *  between the container's own refreshes. */
  readonly #clock = new TickingClock(this);

  #bump(
    card: KitchenCard,
    group: MergedQueueGroup,
    item: StationQueueItem,
    to: Exclude<TicketState, "queued">,
  ): void {
    const stationId = group.stationId ?? this.stationId;
    if (stationId === undefined) return;
    if (group.bumpMode === "ticket") {
      this.#advanceDishes(dishesAt(card, item.state), stationId, to);
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

  #move(group: MergedQueueGroup, item: StationQueueItem): void {
    this.dispatchEvent(
      new CustomEvent("move-station", {
        detail: {
          workingOrderId: group.orderId,
          lineId: item.workingOrderLineId,
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

  /** Item order WITHIN a course is preserved (the server already ordered by `queued_at, line_no`). A
   * missing/undefined course is treated as the null course, so an older/partial payload still groups
   * cleanly. */
  #courseSections(items: readonly StationQueueItem[]): CourseSection[] {
    const byCourse = new Map<string | null, CourseSection>();
    for (const item of items) {
      const course = item.course ?? null;
      const key = course?.id ?? null;
      let section = byCourse.get(key);
      if (section === undefined) {
        section = { course, items: [] };
        byCourse.set(key, section);
      }
      section.items.push(item);
    }
    return [...byCourse.values()].sort((a, b) => courseOrder(a.course) - courseOrder(b.course));
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
    return html`${this.#notices()}${this.#queue()}`;
  }

  #queue(): TemplateResult {
    if (this.groups.length === 0) {
      return html`<p class="empty">${t("station.empty")}</p>`;
    }
    const cards = kitchenCards(this.groups);
    return html`${this.#header(cards)}${this.#board(cards)}`;
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
    const line = `${sign}${dishLine(notice, notice.lineName)}`;
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
        <span class="notice-line">${line}</span>
        ${extra === null ? nothing : html`<span class="notice-extra">${extra}</span>`}
        <span class="notice-order">${notice.orderLabel}</span>
        ${
          notice.wasStarted
            ? html`<span class="notice-started">${t("station.notice.started")}</span>`
            : nothing
        }
        ${
          change === undefined
            ? nothing
            : html`
                ${change.before === null ? nothing : html`<span class="notice-note">${t("kitchen_note.before")}: ${change.before}</span>`}
                ${change.after === null ? nothing : html`<span class="notice-note">${t("kitchen_note.after")}: ${change.after}</span>`}
              `
        }
        ${notice.kind === "allergy_changed" ? kitchenAllergyBlock(notice.allergyBlock!) : nothing}
        ${notice.note ? html`<span class="notice-note">${notice.note}</span>` : nothing}
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
    row: (item: StationQueueItem) => TemplateResult,
    headed: boolean,
  ): TemplateResult {
    return html`<div class="course" data-course=${section.course?.id ?? "none"}>
      ${headed && section.course ? html`<div class="course-head">${section.course.name}</div>` : nothing}
      <ul class="lines">
        ${this.#sectionLines(section.items, row)}
      </ul>
    </div>`;
  }

  /** A mark row goes above each run of consecutive lines agreed after the same period, within one head. */
  #sectionLines(
    items: readonly StationQueueItem[],
    row: (item: StationQueueItem) => TemplateResult,
  ): TemplateResult[] {
    return items.map((item, index) => {
      const period = item.afterPeriod;
      const mark =
        period !== undefined && items[index - 1]?.afterPeriod !== period
          ? html`<li class="after-period" data-after-period>${afterPeriodWords(period)}</li>`
          : nothing;
      return html`${mark}
        <li>${row(item)}</li>`;
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

  #board(cards: readonly KitchenCard[]): TemplateResult {
    return html`<div class="kanban">
      ${COLUMNS.map(
        (state) =>
          html`<section class="column column-${state}" data-column=${state}>
            <h2 class="column-title">${t(`station.state.${state}` as const)}</h2>
            ${cards.filter((card) => card.column === state).map((card) => this.#card(card))}
          </section>`,
      )}
    </div>`;
  }

  /** A card with no fired dish is held: dashed, untimed (D3). */
  #card(card: KitchenCard): TemplateResult {
    const [first] = card.orders as [MergedQueueGroup, ...MergedQueueGroup[]];
    const { since, group } = card;
    // Every bill on one card is one station's, so the first carries its thresholds.
    const accent =
      since === null
        ? "held"
        : this.#accentClasses(classifyBand(since, this.#clockNow(), first.thresholds));
    const labels = [...new Set(card.orders.map((order) => order.label).filter((label) => !!label))];
    const row = (item: StationQueueItem) =>
      this.#renderLine(card, card.orderOf.get(item.id)!, item, this.#stateWord(card, item));
    const sections = this.#courseSections(card.items);
    // One shared course is named in the heading; its dishes keep their `.course` wrapper (D5).
    const sharedCourse = sections.length === 1 ? sections[0]!.course : null;
    // On a card merging bills, each bill's facts and actions name their bill (D11).
    const tag = (order: StationQueueGroup) =>
      card.orders.length === 1 ? "" : ` #${order.orderNumber}`;
    const stage = headingStage(card);
    const head = html`${card.orders.map(
      (order, index) =>
        html`${index === 0 ? nothing : " · "}<span class="number"
            >${orderNumber(order.orderNumber, order.formerNumbers)}</span
          >`,
    )}
    ${kitchenAllergyMarker(card.items.some((item) => item.allergy !== null))}
    ${labels.map((label) => html`<span class="label">${label}</span>`)}
    ${group === null ? nothing : html`<span class="group-name">${groupName(group)}</span>`}
    ${sharedCourse === null ? nothing : html`<span class="course-name">${sharedCourse.name}</span>`}
    ${
      group?.state === "held"
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

  #renderLine(
    card: KitchenCard,
    group: MergedQueueGroup,
    item: StationQueueItem,
    state: TemplateResult | typeof nothing,
  ): TemplateResult {
    const station =
      group.stationId === undefined ? undefined : this.stationNames?.get(group.stationId);
    const main = html`<span class="line-main">
        <span class="line-name">${this.#dish(item)}</span>${state} </span
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
            @click=${() => this.#bump(card, group, item, next)}
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
        @click=${() => this.#move(group, item)}
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
  #dish(item: StationQueueItem): string {
    return dishLine(item, item.name);
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
