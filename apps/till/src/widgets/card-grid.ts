import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
// Side-effect imports: registering each widget element so the switch below can render its tag. This
// host names them only as tags, never as classes — the profile is the wiring, exactly as the counter
// screen's layout is (till-counter-screen.ts).
import "./product-grid.js";
import "./basket.js";
import "./total.js";
import "./tender-pay.js";
import "./held-orders.js";
import "./station-queue.js";
import type { CardInstance, CardType, TabDef } from "../layout.js";
import type { HeldOrderSummary, OrderFlow, StationQueueGroup, TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { CardOutcome, CardProvider } from "./tender-pay.js";

/**
 * SP-B1 renderer: lays a layout-profile TAB's cards on a fluid grid (`repeat(columns, 1fr)`), each
 * card spanning colSpan×rowSpan. Every card is handed the SAME `store` (or an app-owned list), exactly
 * as the counter screen threads them today (`till-counter-screen.ts:267-307`); card events bubble past
 * this host to `till-app` unchanged — this host installs no listeners on them.
 *
 * Capability→absent and permission→locked are B2. Big cards (floor-plan, table-layout-editor,
 * kds-board, expo, table-order) and `notifications` are not rendered on the counter tab in B1 — they
 * arrive in B2. `visibleWhen` (data-condition show/hide) IS honoured here.
 */
@customElement("till-card-grid")
export class TillCardGrid extends LitElement {
  static override styles = css`
    .grid {
      display: grid;
      gap: var(--wt-space-3);
      height: 100%;
      grid-auto-rows: minmax(0, 1fr);
    }
    .cell {
      min-width: 0;
      min-height: 0;
    }
  `;

  /** The tab to render. Undefined until the app resolves a profile — renders nothing meanwhile. */
  @property({ attribute: false }) tab?: TabDef;
  /** The shared working order every store-backed card reads and mutates. Set before connect. */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The tiles the product-grid card shows (the app narrows by menu/diet before handing them here). */
  @property({ attribute: false }) products: TillProduct[] = [];
  /** The node's open parked orders, handed to the held-orders card (app owns and refreshes them). */
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  /** The default station's queue, grouped by order, handed to the prep-queue card. */
  @property({ attribute: false }) stationQueue: StationQueueGroup[] = [];
  /** The default station's id, threaded to the prep-queue card (its bump is keyed by station). */
  @property({ attribute: false }) defaultStationId?: string;
  /** A sale is in flight — threaded straight through to the pay card. */
  @property({ type: Boolean }) busy = false;
  /** The location's pay-timing mode, threaded through to the pay card's own `mode`. */
  @property() orderFlow: OrderFlow = "prepay";
  /** Where the current basket sits in a Mode-I/T order's life, threaded to the pay card's `stage`. */
  @property() stage: "order" | "collect" = "order";
  /** The till's integrated-card wiring, threaded through to the pay card's own `cardProvider`. */
  @property() cardProvider: CardProvider = "none";
  /** Whether the till prompts for a tip on an integrated-card collection, threaded to the pay card. */
  @property({ type: Boolean }) tipsEnabled = false;
  /** The outcome of the most recent non-captured `collect-card` attempt, threaded to the pay card. */
  @property() cardOutcome?: CardOutcome;

  override render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === undefined) return nothing;
    return html`<div class="grid" style="grid-template-columns: repeat(${tab.columns}, 1fr)">
      ${tab.cards.filter((card) => this.#visible(card)).map((card) => this.#cell(card))}
    </div>`;
  }

  #cell(card: CardInstance): TemplateResult {
    const element = this.#element(card);
    if (element === nothing) return html``;
    return html`<div
      class="cell"
      style="grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}"
    >
      ${element}
    </div>`;
  }

  /**
   * Map one card to its element. The switch is EXHAUSTIVE over {@link CardType}, so adding a card type
   * without a case here is a compile error rather than a silently-dropped card. The per-card bindings
   * are verbatim the counter screen's `#widget()` (`till-counter-screen.ts:267-307`).
   */
  #element(card: CardInstance): TemplateResult | typeof nothing {
    switch (card.type) {
      case "product-grid": {
        // Thread the one wired per-card config key, `product-grid.columns`. The config bag is
        // `Record<string, unknown>`, so narrow to a number and pass it through only then — a
        // missing/malformed value leaves the widget's responsive auto-fill default.
        const columns = card.config.columns;
        return html`<till-product-grid
          .products=${this.products}
          .store=${this.store}
          .columns=${typeof columns === "number" ? columns : undefined}
        ></till-product-grid>`;
      }
      case "basket":
        return html`<till-basket .store=${this.store}></till-basket>`;
      case "total":
        return html`<till-total .store=${this.store}></till-total>`;
      case "tender-pay":
        return html`<till-tender-pay
          .store=${this.store}
          .busy=${this.busy}
          .mode=${this.orderFlow}
          .stage=${this.stage}
          .cardProvider=${this.cardProvider}
          .tipsEnabled=${this.tipsEnabled}
          .cardOutcome=${this.cardOutcome}
        ></till-tender-pay>`;
      case "held-orders":
        return html`<till-held-orders .orders=${this.heldOrders}></till-held-orders>`;
      case "prep-queue":
        // KDS-1: the prep-queue card renders the default station's queue as a ticket RAIL (grouped by
        // order), per-line bump. The kanban board + station picker live on the station-display screen.
        return html`<till-station-queue
          .groups=${this.stationQueue}
          .view=${"rail"}
          .stationId=${this.defaultStationId}
        ></till-station-queue>`;
      // Big cards and `notifications` are not rendered on the counter tab in B1 — they arrive in B2.
      case "notifications":
      case "floor-plan":
      case "table-layout-editor":
      case "kds-board":
      case "expo":
      case "table-order":
        return nothing;
    }
  }

  /** Whether a card passes its `visibleWhen` data-condition gate (no gate ⇒ always shown). */
  #visible(card: CardInstance): boolean {
    const states = card.visibleWhen;
    if (states === undefined || states.length === 0) return true;
    const current = this.#currentState(card.type);
    return current !== undefined && states.includes(current);
  }

  /** Each card's data-condition state, computed from data the host already holds (spec §7). */
  #currentState(type: CardType): string | undefined {
    switch (type) {
      case "held-orders":
        return this.heldOrders.length > 0 ? "has-parked" : "empty";
      case "prep-queue":
        return this.stationQueue.length > 0 ? "has-items" : "empty";
      default:
        return undefined;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-card-grid": TillCardGrid;
  }
}
