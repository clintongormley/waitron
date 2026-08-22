import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import type { StationQueueGroup, StationQueueItem, TicketState } from "../api/client.js";

/** The kitchen state each ticket item advances TO next. `ready` is terminal (a counter order's handover
 *  is an order-level collect, not a kitchen state — KDS-1 §2d), so a `ready` line has no bump. */
const NEXT: Record<TicketState, Exclude<TicketState, "queued"> | undefined> = {
  queued: "preparing",
  preparing: "ready",
  ready: undefined,
};

/** The three kitchen states in flow order — the kanban columns (Nuevo / Preparando / Listo), left to
 *  right, and the order a `ready`-tail line sorts after a fresh one. */
const COLUMNS: readonly TicketState[] = ["queued", "preparing", "ready"];

/** How the two views bump: `line` (the source of truth) advances the one tapped item; `ticket` (the
 *  convenience the `bump_mode = 'ticket'` venue setting drives) advances the whole order at the station. */
export type BumpMode = "line" | "ticket";

/** A line paired with the order it belongs to — what a kanban column renders (its cells cut across
 *  orders, so each carries back its order's number + queued-time for the label and the age accent). */
interface FlatItem {
  item: StationQueueItem;
  group: StationQueueGroup;
}

/**
 * The per-station KITCHEN QUEUE (KDS-1, design §5a): one station's ticket items grouped by order, shown
 * through one of two lenses — a **kanban board** (Nuevo / Preparando / Listo columns, the default) or a
 * **ticket rail** (a card per order). Both render the SAME data; the parent flips {@link view}.
 *
 * It is the per-line/per-station successor to #63's whole-order prep-queue widget. Like that widget (and
 * `till-held-orders`) it is a PURE VIEW: it holds no state, never talks to the store or the API, and the
 * container it sits in (the station screen, or — for the default station — the app) owns the {@link groups}
 * and refreshes them. A tap on a line emits a composed, bubbling advance the container turns into an API
 * call, exactly the event → container → server shape the prep-queue widget established (only the events and
 * the entry shape changed): {@link BumpMode} `line` (the default) fires `advance-ticket-item { itemId, to }`
 * — the per-line source of truth — while `ticket` fires `advance-ticket { orderId, stationId, to }`, the
 * whole-order convenience (so ticket mode needs {@link stationId}). A `ready` line is terminal and renders
 * inert (no button), like the prep-queue's collected row.
 *
 * AGE. Each order is coloured by how long its OLDEST line has waited ({@link StationQueueGroup.queuedAt}):
 * fresh (< 5 min), warm (< 10), hot (≥ 10). The accent is a LEFT BORDER, never a text background, so the
 * arbitrary colour cannot fail a11y contrast (the `till-floor-screen` occupancy-accent trick). `now` is an
 * injectable clock so the buckets are deterministic under test.
 *
 * Lit + `@waitron/ui` `baseStyles` + theme tokens only — no hardcoded chrome colour/spacing, so it follows
 * the operator's theme like every sibling. Copy is the till's i18n (`station.*`); identifiers stay English.
 */
@customElement("till-station-queue")
export class TillStationQueue extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      /* KANBAN — three state columns that flow to fill the width and wrap on a narrow till. */
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

      /* RAIL — a card per order, wrapping across rows. */
      .rail {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: flex-start;
      }

      .ticket {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 12rem;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The age accent lives on the left edge (coloured by bucket below), never behind text. */
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .ticket-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .label {
        color: var(--wt-color-text);
      }

      .age {
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

      /* A line cell — the tappable bump target (a plain button so it themes like the floor cards). A
         ready-tail cell renders the same box as a non-interactive span (.line.terminal). */
      .line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
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

      button.line {
        cursor: pointer;
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

      /* The dish label (qty × name) — the primary text a cook reads. Truncates rather than wrapping so
         a long name never blows out the cell/line width (min-width:0 lets a flex child shrink). */
      .line-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .line-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Age accents on the rail card's left edge — a data-driven colour, never behind text (a11y). */
      .ticket.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .ticket.age-hot {
        border-left-color: var(--wt-color-danger);
      }
    `,
  ];

  /** One station's ticket items grouped by order, oldest first (the container owns + refreshes them). */
  @property({ attribute: false }) groups: StationQueueGroup[] = [];
  /** The lens: `kanban` board (default) or `ticket` rail — flipped by the station screen's toggle. */
  @property() view: "kanban" | "rail" = "kanban";
  /** Per-line (default) vs whole-ticket bump — the `bump_mode` venue setting, threaded from the app. */
  @property() bumpMode: BumpMode = "line";
  /** The station these items are AT — required for the whole-ticket bump's event (ticket mode). */
  @property() stationId?: string;
  /** Injectable clock for age colouring; defaults to the wall clock. Set in tests for deterministic buckets. */
  @property({ attribute: false }) now?: number;

  /** Advance the tapped line — per-line in `line` mode (the truth), whole-ticket in `ticket` mode (the
   * convenience). A terminal (`ready`) line has no successor, so this is a no-op for it; ticket mode with
   * no {@link stationId} likewise no-ops (the whole-ticket route is keyed by station). */
  #bump(group: StationQueueGroup, item: StationQueueItem): void {
    const to = NEXT[item.state];
    if (to === undefined) return;
    if (this.bumpMode === "ticket") {
      if (this.stationId === undefined) return;
      this.dispatchEvent(
        new CustomEvent("advance-ticket", {
          detail: { orderId: group.orderId, stationId: this.stationId, to },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: item.id, to },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** The age bucket for a group's oldest line: fresh (< 5 min), warm (< 10), hot (≥ 10). */
  #ageBucket(queuedAt: string): "fresh" | "warm" | "hot" {
    const elapsedMin = ((this.now ?? Date.now()) - Date.parse(queuedAt)) / 60000;
    if (elapsedMin >= 10) return "hot";
    if (elapsedMin >= 5) return "warm";
    return "fresh";
  }

  /** Whole minutes a group has waited (never negative), for the "N min" age label. */
  #elapsedMinutes(queuedAt: string): number {
    return Math.max(0, Math.floor(((this.now ?? Date.now()) - Date.parse(queuedAt)) / 60000));
  }

  override render() {
    if (this.groups.length === 0) {
      return html`<p class="empty">${t("station.empty")}</p>`;
    }
    return this.view === "rail" ? this.#rail() : this.#kanban();
  }

  /** RAIL — a card per order, its lines listed with per-line bump. */
  #rail(): TemplateResult {
    return html`<div class="rail">
      ${this.groups.map((group) => {
        const bucket = this.#ageBucket(group.queuedAt);
        return html`<article class="ticket age-${bucket}" data-order=${group.orderNumber}>
          <div class="ticket-head">
            <span class="number">#${group.orderNumber}</span>
            ${group.label ? html`<span class="label">${group.label}</span>` : nothing}
            <span class="age">${this.#elapsedMinutes(group.queuedAt)} ${t("station.min")}</span>
          </div>
          <ul class="lines">
            ${group.items.map((item) => html`<li>${this.#line(group, item)}</li>`)}
          </ul>
        </article>`;
      })}
    </div>`;
  }

  /** KANBAN — three state columns, each holding every order's lines in that state, oldest order first. */
  #kanban(): TemplateResult {
    // Flatten to (item, group) pairs once, preserving the groups' oldest-first order, then bucket by state.
    const flat: FlatItem[] = this.groups.flatMap((group) =>
      group.items.map((item) => ({ item, group })),
    );
    return html`<div class="kanban">
      ${COLUMNS.map((state) => {
        const cells = flat.filter((f) => f.item.state === state);
        return html`<section class="column column-${state}" data-column=${state}>
          <h2 class="column-title">${t(`station.state.${state}` as const)}</h2>
          ${cells.map(({ group, item }) => this.#cell(group, item))}
        </section>`;
      })}
    </div>`;
  }

  /** A rail line: the dish (`qty× name`) + its localised state, tappable to bump unless terminal
   *  (`ready`). The card head already names the order, so a line needs only its dish + state. */
  #line(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const dish = html`<span class="line-name">${this.#dish(item)}</span>`;
    const state = html`<span class="line-state"
      >${t(`station.state.${item.state}` as const)}</span
    >`;
    if (NEXT[item.state] === undefined) {
      return html`<span class="line state-${item.state} terminal" data-item=${item.id}
        >${dish}${state}</span
      >`;
    }
    return html`<button
      class="line state-${item.state}"
      data-item=${item.id}
      aria-label=${this.#bumpLabel(group)}
      @click=${() => this.#bump(group, item)}
    >
      ${dish}${state}
    </button>`;
  }

  /** A kanban cell: the dish (`qty× name`) tagged with its order — the columns cut across orders, so a
   *  cell keeps the order number (which order this dish belongs to) beside the dish. Tappable to bump
   *  unless terminal (`ready`). */
  #cell(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const dish = html`<span class="line-name">${this.#dish(item)}</span>`;
    const tag = html`<span class="number"
      >#${group.orderNumber}${group.label ? html` · ${group.label}` : nothing}</span
    >`;
    if (NEXT[item.state] === undefined) {
      return html`<span class="line state-${item.state} terminal" data-item=${item.id}
        >${dish}${tag}</span
      >`;
    }
    return html`<button
      class="line state-${item.state}"
      data-item=${item.id}
      aria-label=${this.#bumpLabel(group)}
      @click=${() => this.#bump(group, item)}
    >
      ${dish}${tag}
    </button>`;
  }

  /** The line's dish label for the kitchen display: `qty× name`, e.g. "2× Paella". The name resolves in
   *  the operator locale with a first-available fallback (matching {@link productName} — the till's own
   *  set-at-boot `currentLocale()` is `TillInfo.locale`), degrading to "" only for an empty map; the
   *  quantity is the line's numeric(_,3) trimmed of trailing zeros ("2.000" → "2", "0.320" → "0.32"),
   *  the same trim `till-table-order-screen` uses. */
  #dish(item: StationQueueItem): string {
    const name = item.descriptions[currentLocale()] ?? Object.values(item.descriptions)[0] ?? "";
    const qty = item.quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return `${qty}× ${name}`;
  }

  /** The accessible name for a bump control — whole-ticket vs per-line, named with the order number. */
  #bumpLabel(group: StationQueueGroup): string {
    const verb = this.bumpMode === "ticket" ? t("station.bump_ticket") : t("station.advance");
    return `${verb} #${group.orderNumber}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-station-queue": TillStationQueue;
  }
}
