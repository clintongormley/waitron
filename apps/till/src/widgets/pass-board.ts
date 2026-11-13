import { ContentLanguageController, HelpModeController, baseStyles } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TimingBand } from "@waitron/shared";
import type { PassBoard } from "../api/client.js";
import { helpText } from "../i18n/help-strings.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";
import { type BoardMeasure, columnsFit } from "../state/kitchen-board-fit.js";
import { type ColumnKey, type ColumnState, PASS_COLUMNS } from "../state/kitchen-columns.js";
import { type OverviewRow, overviewRows, rowsToMake } from "../state/kitchen-overview.js";
import {
  type CardView,
  type ItemCaption,
  type ItemView,
  type PassMode,
  passCardViews,
  passOrderPlace,
  passOverdueCount,
  passOverviewDishes,
} from "../state/pass-view.js";
import { kitchenPortionKey, portionGroups } from "../state/portion-groups.js";
import { dietBadgeStyles, dietBadges } from "./diet-badges.js";
import { dishLine } from "./dish-format.js";
import { groupName } from "./group-name.js";
import { helpBadge, kitchenHelpStyles } from "./help-badge.js";
import {
  columnHeading,
  dishAllergens,
  dishModifiers,
  dishNote,
  heldPart,
  kitchenBoardStyles,
  measureBoard,
  overviewList,
} from "./kitchen-board-parts.js";
import {
  kitchenAllergyBlock,
  kitchenAllergyMarker,
  kitchenAllergyStyles,
} from "./kitchen-allergy-block.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";
import { queueCrossRefs } from "./queue-crossrefs.js";

type ServerColumn = "held" | "toFire" | "inProgress" | "ready";

interface DrawnColumn {
  title: StringKey;
  /** The Columns window's name, which tells Held + To fire from the separate To fire. */
  name: StringKey;
  draws: ServerColumn;
  /** The server's held cards go last, under a Held heading drawn only while one is held. */
  heldPart?: true;
}

/** Its key order sets only the order of {@link passColumnNames}; the board follows the layout's. */
const DRAWN: Partial<Record<ColumnKey, DrawnColumn>> = {
  toFire: {
    title: "pass.column.to_fire",
    name: "pass.columns_held_to_fire",
    draws: "toFire",
    heldPart: true,
  },
  held: { title: "pass.column.held", name: "pass.column.held", draws: "held" },
  toFireOnly: { title: "pass.column.to_fire", name: "pass.column.to_fire", draws: "toFire" },
  inProgress: {
    title: "pass.column.in_progress",
    name: "pass.column.in_progress",
    draws: "inProgress",
  },
  ready: { title: "pass.column.ready", name: "pass.column.ready", draws: "ready" },
};

/** The pass's column names, for the Columns window. */
export function passColumnNames(): Map<ColumnKey, string> {
  return new Map([
    ["overview", t("station.overview")],
    ...Object.entries(DRAWN).map(([key, drawn]) => [key as ColumnKey, t(drawn.name)] as const),
  ]);
}

/** A pure view of a pass board: it reads nothing and acts by events. */
@customElement("till-pass-board")
export class TillPassBoard extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    dietBadgeStyles,
    kitchenAllergyStyles,
    orderNumberStyles,
    kitchenBoardStyles,
    kitchenHelpStyles,
    css`
      :host {
        display: block;
      }

      .width-probe {
        height: 0;
      }

      .board-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-2);
      }

      .columns-anchor {
        display: flex;
        margin-inline-start: auto;
      }

      .lever-anchor {
        display: flex;
        flex-direction: column;
      }

      .overdue-count {
        display: inline-block;
        margin: 0;
        padding: var(--wt-space-1) var(--wt-space-3);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .kanban {
        display: flex;
        align-items: stretch;
        gap: var(--wt-space-3);
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      /* A collapsed section in the list is a full-width heading, not a strip. */
      .list .collapsed .column-toggle {
        padding: 0 var(--wt-space-2);
        writing-mode: horizontal-tb;
      }

      .ticket {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .ticket.held {
        border-style: dashed;
        border-left-style: solid;
      }

      .ticket.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .ticket.age-overdue,
      .ticket.age-forgotten {
        border-left-color: var(--wt-color-danger);
      }

      /* .flash is set only while reduced motion is not asked for; the @media rule also stops a card
         drawn before the preference changed. */
      .ticket.age-forgotten.flash {
        animation: age-forgotten-flash var(--wt-duration-pulse-fast) ease-in-out infinite;
      }

      @keyframes age-forgotten-flash {
        50% {
          border-left-color: transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ticket.age-forgotten.flash {
          animation: none;
        }
      }

      .ticket-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-2);
      }

      .kind,
      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .age {
        margin-inline-start: auto;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .items {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .item {
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

      .item.state-queued {
        border-left-color: var(--wt-color-text-muted);
      }

      .item.state-preparing {
        border-left-color: var(--wt-color-primary);
      }

      .item.state-ready {
        border-left-color: var(--wt-color-success);
      }

      /* Muted text and a dotted box, never opacity, which would fail the contrast sweep; the
         caption says why in words. */
      .item.dimmed {
        border-style: dotted;
        border-left-style: solid;
        border-top-color: var(--wt-color-text-muted);
        border-right-color: var(--wt-color-text-muted);
        border-bottom-color: var(--wt-color-text-muted);
        color: var(--wt-color-text-muted);
      }

      .item.dimmed .line-diet * {
        color: var(--wt-color-text-muted);
      }

      .item.held {
        border-style: dashed;
        border-left-style: solid;
        color: var(--wt-color-text-muted);
      }

      .item-caption,
      .item-closed {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .item-closed {
        font-weight: var(--wt-font-weight-bold);
      }

      .kitchen-note {
        margin: 0;
        overflow-wrap: anywhere;
        color: var(--wt-color-text);
      }

      .item-forgotten-flag {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .item-modifiers,
      .item-crossrefs,
      .item-customisation {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      .item-modifiers,
      .item-crossrefs,
      .item-note {
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

      .item-allergens {
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
        border-radius: var(--wt-radius-full);
      }

      .fire,
      .lever {
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

      .fire:disabled {
        border-color: var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text-muted);
        cursor: not-allowed;
      }

      wt-button.reprint {
        display: block;
      }
    `,
  ];

  @property({ attribute: false }) board: PassBoard = {
    held: [],
    toFire: [],
    inProgress: [],
    ready: [],
    overview: [],
  };
  @property({ attribute: false }) mode: PassMode = "pass";
  @property({ type: Boolean }) runsPass = false;
  @property({ attribute: false }) columns: ColumnState = PASS_COLUMNS;
  /** The screen's ticking clock, so bands climb between reads. */
  @property({ attribute: false }) now = Date.now();
  /** Card keys with a Fire out. */
  @property({ attribute: false }) sending: ReadonlySet<string> = new Set();
  /** `undefined` checks the live `prefers-reduced-motion` query on every render. */
  @property({ attribute: false }) reducedMotion?: boolean;
  /** Reprint is a till's; the screen decides, and a monitor never draws it. */
  @property({ type: Boolean }) showReprint = false;

  /** Badges are drawn only while help is on, so with help off no screen draws one. */
  readonly #help = new HelpModeController(this);
  #cardBadgeDrawn = false;
  #leverBadgeDrawn = false;
  #measured?: BoardMeasure;
  #resizing?: ResizeObserver;
  /** The card views and their rows, rebuilt only when what they read changes; the locale is one,
   * since a card's kind word is worded when its view is built. */
  #viewsFrom?: readonly unknown[];
  #views = new Map<ColumnKey, CardView[]>();
  #rows = new Map<CardView, ItemView[][]>();
  #overdue = 0;
  #overviewFrom?: PassBoard;
  #overview: OverviewRow[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#observeWidth();
  }

  override firstUpdated(): void {
    this.#observeWidth();
  }

  /** Watches a line of no height across the board, not the host, whose height the layout changes. */
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
    this.#measured = measureBoard(this);
    const from = [this.board, this.mode, this.runsPass, this.now, currentLocale()];
    if (this.#viewsFrom?.every((input, at) => input === from[at]) !== true) {
      this.#viewsFrom = from;
      this.#views = passCardViews(this.board, this.mode, this.runsPass, this.now);
      this.#rows = new Map();
      this.#overdue = passOverdueCount(this.#views);
    }
    if (this.#overviewFrom !== this.board) {
      this.#overviewFrom = this.board;
      this.#overview = overviewRows(passOverviewDishes(this.board));
    }
  }

  /** Built when a card is first drawn, so a collapsed or hidden column's cards cost nothing. */
  #rowsOf(view: CardView): ItemView[][] {
    let built = this.#rows.get(view);
    if (built === undefined) {
      built = rows(view.items);
      this.#rows.set(view, built);
    }
    return built;
  }

  override render() {
    this.#cardBadgeDrawn = false;
    this.#leverBadgeDrawn = false;
    const views = this.#views;
    const overdue = this.#overdue;
    const shown = this.columns.order.filter(
      (key) =>
        !this.columns.hidden.includes(key) && (key === "overview" || DRAWN[key] !== undefined),
    );
    const fits =
      this.#measured === undefined || columnsFit(this.#measured, shown, this.columns.collapsed);
    return html`<div class="width-probe"></div>
      <div class="board-head" data-board-head>
        <slot name="lead"></slot>${
          overdue === 0
            ? nothing
            : html`<p class="overdue-count" data-overdue-count>
                ${overdue} ${t("station.overdue_count")}
              </p>`
        }<span class="help-anchor help-inset columns-anchor"
          ><wt-button
            data-columns-open
            variant="secondary"
            @click=${(event: Event) =>
              this.#emit("open-columns", { opener: event.currentTarget as HTMLElement })}
            >${t("station.columns")}</wt-button
          >${
            this.#help.on
              ? helpBadge("help.kitchen.columns", t("station.columns"), {
                  guide: "kitchen-service.pass-screen",
                })
              : nothing
          }</span
        >
      </div>
      <slot name="status"></slot>
      <div class=${fits ? "kanban" : "list"}>${shown.map((key) => this.#column(key, views))}</div>`;
  }

  #column(key: ColumnKey, views: ReadonlyMap<ColumnKey, CardView[]>): TemplateResult {
    const collapsed = this.columns.collapsed.includes(key);
    const toggle = () => this.#emit("toggle-column", { key });
    const drawn = DRAWN[key];
    if (drawn === undefined) {
      const rows = this.#overview;
      return html`<section
        class="column column-overview ${collapsed ? "collapsed" : ""}"
        data-column="overview"
      >
        ${columnHeading(key, t("station.overview"), rowsToMake(rows), collapsed, toggle)}
        ${collapsed ? nothing : overviewList(rows)}
      </section>`;
    }
    const cards = views.get(drawn.draws) ?? [];
    const held = drawn.heldPart === undefined ? [] : (views.get("held") ?? []);
    return html`<section class="column ${collapsed ? "collapsed" : ""}" data-column=${key}>
      ${columnHeading(key, t(drawn.title), cards.length + held.length, collapsed, toggle)}
      ${
        collapsed
          ? nothing
          : html`${cards.map((view) => this.#card(view))}
            ${held.length === 0 ? nothing : heldPart(held.length)}
            ${held.map((view) => this.#card(view))}`
      }
    </section>`;
  }

  #card(view: CardView): TemplateResult {
    const { card } = view;
    const accent =
      view.column === "held" ? "held" : view.band === null ? "" : this.#accentClasses(view.band);
    const badge = this.#help.on && !this.#cardBadgeDrawn;
    this.#cardBadgeDrawn = true;
    return html`<article class="ticket help-anchor help-inset ${accent}" data-card=${card.key}>
      <div class="ticket-head">
        ${view.kindWord === null ? nothing : html`<span class="kind">${view.kindWord}</span>`}
        ${card.orders.map(
          (order) =>
            html`<span class="number">${orderNumber(order.orderNumber, order.formerNumbers)}</span>
              ${placeLabel(passOrderPlace(order))}`,
        )}
        ${card.group === undefined ? nothing : html`<span class="group-name">${groupName(card.group)}</span>`}
        ${kitchenAllergyMarker(view.allergy)} ${this.#age(view)}
      </div>
      ${card.orders.map((order) =>
        order.kitchenNote
          ? html`<p class="kitchen-note" data-kitchen-note>
              ${t("kitchen_note.heading")}: ${order.kitchenNote}
            </p>`
          : nothing,
      )}
      <ul class="items">
        ${this.#rowsOf(view).map((members) => this.#item(members))}
      </ul>
      ${this.#fire(view)}${this.#groupReady(view)}${this.#billReady(view)}${this.#reprints(view)}${
        badge
          ? helpBadge("help.pass.card", helpText("help.kitchen.cards_part"), {
              guide: "kitchen-service.pass-screen",
            })
          : nothing
      }
    </article>`;
  }

  #age(view: CardView): TemplateResult | typeof nothing {
    if (view.ageFrom === null) return nothing;
    const minutes = String(Math.max(0, Math.floor((this.now - Date.parse(view.ageFrom)) / 60000)));
    return html`<span class="age"
      >${
        view.ageWord === "ready"
          ? t("table.row_ready_ago").replace("{n}", minutes)
          : `${minutes} ${t("station.min")}`
      }</span
    >`;
  }

  /** `members`: identical portions drawn as one row from its first. */
  #item(members: readonly ItemView[]): TemplateResult {
    const view = members[0]!;
    const { item } = view;
    const held = item.phase === "held";
    const label = dishLine(
      {
        quantity: members.length === 1 ? item.qty : String(members.length),
        unitName: item.unitName,
        soldInEach: item.soldInEach,
      },
      item.name,
    );
    return html`<li
      class="item state-${item.state} ${view.dimmed ? "dimmed" : ""} ${held ? "held" : ""}"
      data-item=${item.id}
      ?data-dimmed=${view.dimmed}
    >
      <span class="item-name">${label}</span>
      ${this.#caption(view.caption)}
      ${
        view.forgotten
          ? html`<span class="item-forgotten-flag" data-forgotten
              >${t("expo.item_forgotten")}</span
            >`
          : nothing
      }
      ${
        view.closed === null
          ? nothing
          : html`<span class="item-closed" data-station-closed
              >${t(
                view.closed === "blocked"
                  ? "pass.station_closed_dish"
                  : "pass.station_closed_extra",
              ).replaceAll("{station}", () => item.stationName)}</span
            >`
      }
      ${dishNote(item, "item")}${dishModifiers(item, "item")}${queueCrossRefs(item, "item")}${dishAllergens(item, "item")}${dietBadges(
        item.asServedDiet,
        `item-diet-${item.id}`,
      )}${kitchenAllergyBlock(item.allergy)}
    </li>`;
  }

  #caption(caption: ItemCaption): TemplateResult | typeof nothing {
    const words = captionWords(caption);
    return words === null ? nothing : html`<span class="item-caption">${words}</span>`;
  }

  #fire(view: CardView): TemplateResult | typeof nothing {
    if (!view.fire.shown) return nothing;
    const key = view.card.key;
    return html`<button
      class="fire"
      data-pass-fire=${key}
      aria-label=${`${t("pass.fire")} ${view.card.orders.map((order) => `#${order.orderNumber}`).join(" · ")}`}
      ?disabled=${!view.fire.enabled || this.sending.has(key)}
      @click=${() => this.#emit("pass-fire", { key })}
    >
      ${t("pass.fire")}
    </button>`;
  }

  #groupReady(view: CardView): TemplateResult | typeof nothing {
    const { card } = view;
    if (!view.groupReady || card.target.kind !== "group") return nothing;
    const name = card.group === undefined ? "" : groupName(card.group);
    return this.#withLeverBadge(
      t("expo.group_ready"),
      html`<button
        class="lever ready"
        data-group-ready=${card.target.groupId}
        aria-label=${`${t("expo.group_ready")} ${name}`}
        @click=${() => this.#emit("pass-group-ready", { key: card.key })}
      >
        ${t("expo.group_ready")}
      </button>`,
    );
  }

  #billReady(view: CardView): TemplateResult | typeof nothing {
    if (!view.billReady || view.card.target.kind !== "bill") return nothing;
    return this.#withLeverBadge(
      t("expo.ready"),
      html`<button
        class="lever ready"
        data-ready=${view.card.target.workingOrderId}
        @click=${() => this.#emit("pass-bill-ready", { key: view.card.key })}
      >
        ${t("expo.ready")}
      </button>`,
    );
  }

  /** While help is on, the first lever drawn sits in a wrapper that holds its badge beside it, never
   * inside it. */
  #withLeverBadge(label: string, lever: TemplateResult): TemplateResult {
    if (!this.#help.on || this.#leverBadgeDrawn) return lever;
    this.#leverBadgeDrawn = true;
    return html`<span class="help-anchor help-inset lever-anchor"
      >${lever}${helpBadge("help.pass.ready", label, { guide: "kitchen-service.pass-screen" })}</span
    >`;
  }

  /** Its accessible name is the slotted text: a one-bill card's heading gives the bill, and a card
   * across bills names each bill's button. */
  #reprints(view: CardView): TemplateResult[] | typeof nothing {
    if (!this.showReprint || this.mode === "monitor" || view.column === "held") return nothing;
    const { orders } = view.card;
    return orders.map(
      ({ orderId, orderNumber }) =>
        html`<wt-button
          class="reprint"
          data-reprint=${orderId}
          variant="secondary"
          @click=${() => this.#emit("pass-reprint", { orderId })}
          >${t("expo.reprint")}${orders.length === 1 ? "" : ` #${orderNumber}`}</wt-button
        >`,
    );
  }

  #emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #accentClasses(band: TimingBand): string {
    const reduced =
      this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return `age-${band}${band === "forgotten" && !reduced ? " flash" : ""}`;
  }
}

function placeLabel(place: string | undefined): TemplateResult | typeof nothing {
  return place ? html`<span class="label">${place}</span>` : nothing;
}

/** A portion's time is keyed only as the Forgotten mark it draws: the server stamps each ticket
 * item's `queuedAt` on its own, so portions fired together can differ by a millisecond. */
function rows(items: readonly ItemView[]): ItemView[][] {
  return portionGroups(
    items,
    (view) =>
      kitchenPortionKey(view.item, view.item.qty, [
        view.item.stationName,
        view.item.course?.id ?? null,
        view.item.orderId,
        view.item.phase,
        view.dimmed,
        view.closed,
        view.forgotten,
      ]),
    () => 0,
  );
}

function captionWords(caption: ItemCaption): string | null {
  switch (caption.kind) {
    case "none":
      return null;
    case "waitingForPass":
      return `${t("pass.waiting_for_pass")} · ${caption.station}`;
    case "otherPass":
      return t("pass.other_pass").replace("{station}", () => caption.station);
    case "state":
      return `${t(`station.state.${caption.state}` as const)} · ${caption.station}`;
    case "alreadyAt":
      return `${t(`station.state.${caption.state}` as const)} · ${t("pass.already_at").replace(
        "{station}",
        () => caption.station,
      )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-pass-board": TillPassBoard;
  }
}
