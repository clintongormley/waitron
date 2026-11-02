import { ContentLanguageController, baseStyles } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TimingBand } from "@waitron/shared";
import type { PassBoard } from "../api/client.js";
import { t } from "../i18n/t.js";
import { type ColumnKey, type ColumnState, PASS_COLUMNS } from "../state/kitchen-columns.js";
import {
  type CardView,
  type ItemCaption,
  type ItemView,
  type PassMode,
  passCardViews,
  passOverdueCount,
} from "../state/pass-view.js";
import { dishLine } from "./dish-format.js";
import { groupName } from "./group-name.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";

const COLUMN_WORDS = {
  held: "pass.column.held",
  toFire: "pass.column.to_fire",
  inProgress: "pass.column.in_progress",
  ready: "pass.column.ready",
} as const;

/** A pure view of a pass board: it reads nothing and acts by events. */
@customElement("till-pass-board")
export class TillPassBoard extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    orderNumberStyles,
    css`
      :host {
        display: block;
      }

      .overdue-count {
        display: inline-block;
        margin: 0 0 var(--wt-space-2);
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

      .column {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 0;
      }

      .column-heading {
        display: flex;
        gap: var(--wt-space-1);
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }

      .column-count {
        margin-inline-start: auto;
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
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      /* Muted text and a dotted box, never opacity, which would fail the contrast sweep; the
         caption says why in words. */
      .item.dimmed {
        border-style: dotted;
        color: var(--wt-color-text-muted);
      }

      .item.held {
        border-style: dashed;
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
  @property({ type: Boolean }) reprint = false;

  override render() {
    const views = passCardViews(this.board, this.mode, this.runsPass, this.now);
    const overdue = passOverdueCount(views);
    const shown = this.columns.order.filter(
      (key) => !this.columns.hidden.includes(key) && views.has(key),
    );
    return html`${
        overdue === 0
          ? nothing
          : html`<p class="overdue-count" data-overdue-count>
              ${overdue} ${t("station.overdue_count")}
            </p>`
      }
      <div class="kanban">${shown.map((key) => this.#column(key, views.get(key)!))}</div>`;
  }

  #column(key: ColumnKey, cards: readonly CardView[]): TemplateResult {
    return html`<section class="column" data-column=${key}>
      <h2 class="column-heading">
        <span class="column-title">${t(COLUMN_WORDS[key as keyof typeof COLUMN_WORDS])}</span
        ><span class="column-count" data-column-count>${cards.length}</span>
      </h2>
      ${cards.map((view) => this.#card(view))}
    </section>`;
  }

  #card(view: CardView): TemplateResult {
    const { card } = view;
    const accent =
      view.column === "held" ? "held" : view.band === null ? "" : this.#accentClasses(view.band);
    return html`<article class="ticket ${accent}" data-card=${card.key}>
      <div class="ticket-head">
        ${view.kindWord === null ? nothing : html`<span class="kind">${view.kindWord}</span>`}
        ${card.orders.map(
          (order) =>
            html`<span class="number">${orderNumber(order.orderNumber, order.formerNumbers)}</span>
              ${order.tableLabel ? html`<span class="label">${order.tableLabel}</span>` : nothing}`,
        )}
        ${card.group === undefined ? nothing : html`<span class="group-name">${groupName(card.group)}</span>`}
        ${this.#age(view)}
      </div>
      <ul class="items">
        ${view.items.map((item) => this.#item(item))}
      </ul>
      ${this.#fire(view)}${this.#groupReady(view)}${view.courseReady.map((course) =>
        this.#courseReady(view, course),
      )}${this.#reprints(view)}
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

  #item(view: ItemView): TemplateResult {
    const { item } = view;
    const held = item.phase === "held";
    const label = dishLine(
      { quantity: item.qty, unitName: item.unitName, soldInEach: item.soldInEach },
      item.name,
    );
    return html`<li
      class="item ${view.dimmed ? "dimmed" : ""} ${held ? "held" : ""}"
      data-item=${item.id}
      ?data-dimmed=${view.dimmed}
    >
      <span class="item-name">${label}</span>
      ${this.#caption(view.caption)}
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
    return html`<button
      class="lever ready"
      data-group-ready=${card.target.groupId}
      aria-label=${`${t("expo.group_ready")} ${name}`}
      @click=${() => this.#emit("pass-group-ready", { key: card.key })}
    >
      ${t("expo.group_ready")}
    </button>`;
  }

  #courseReady(view: CardView, course: { orderId: string; courseId: string }): TemplateResult {
    const name =
      view.card.items.find((item) => item.course?.id === course.courseId)?.course?.name ?? "";
    return html`<button
      class="lever ready"
      data-ready=${course.courseId}
      aria-label=${`${t("expo.ready")} ${name}`}
      @click=${() => this.#emit("pass-course-ready", { key: view.card.key, ...course })}
    >
      ${t("expo.ready")}
    </button>`;
  }

  #reprints(view: CardView): TemplateResult[] | typeof nothing {
    if (!this.reprint || this.mode === "monitor" || view.column === "held") return nothing;
    return view.card.orders.map(
      ({ orderId }) =>
        html`<wt-button
          class="reprint"
          data-reprint=${orderId}
          variant="secondary"
          @click=${() => this.#emit("pass-reprint", { orderId })}
          >${t("expo.reprint")}</wt-button
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
