import type { DietPredicate } from "../menu-filter.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
// Side-effect imports: registering each widget element so the switch below can render its tag.
import "./product-grid.js";
import "./basket.js";
import "./total.js";
import "./tender-pay.js";
import "./held-orders.js";
import "./station-queue.js";
import "../screens/till-floor-screen.js";
import "../screens/till-expo-screen.js";
import "../screens/till-station-screen.js";
import "../screens/till-table-order-screen.js";
import { CARD_REQUIRED_CAPABILITY, CARD_REQUIRED_PERMISSION } from "../layout.js";
import type { CapabilityFlag, CardInstance, CardType, TabDef } from "../layout.js";
import type {
  DeviceStation,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  StationQueueGroup,
  TableServiceStatus,
  TableState,
  TabLine,
  TillActiveReader,
  TillApi,
  TillCourse,
  TillMenu,
  TillProduct,
} from "../api/client.js";
import type { BumpMode, FireControlMode } from "./station-queue.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { CardOutcome, CardProvider } from "./tender-pay.js";

/**
 * Lays a canvas tab's cards on a grid. Every store-backed card is handed the SAME `store`; card events
 * bubble past this host to `till-app` unchanged — this host installs no listeners on them.
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
    /* Permission→LOCKED: the card stays visible but dimmed and non-interactive (?inert). The dim uses
       the shared disabled-opacity token, not a hardcoded number. */
    .cell.locked {
      opacity: var(--wt-opacity-disabled);
    }
  `;

  @property({ attribute: false }) tab?: TabDef;
  @property({ attribute: false }) store!: WorkingOrderStore;
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  @property({ attribute: false }) stationQueue: StationQueueGroup[] = [];
  @property({ attribute: false }) defaultStationId?: string;
  @property({ type: Boolean }) busy = false;
  @property() orderFlow: OrderFlow = "prepay";
  @property() stage: "order" | "collect" = "order";
  @property() cardProvider: CardProvider = "none";
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;
  @property({ attribute: false }) activeReaders: TillActiveReader[] = [];
  @property() defaultReaderId?: string;
  @property({ attribute: false }) capabilities: CapabilityFlag[] = [];
  @property({ attribute: false }) api?: TillApi;
  @property() fireControl?: FireControlMode;
  @property({ attribute: false }) zones: FloorZone[] = [];
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ type: Boolean }) canConfigureTill = false;
  @property() bumpMode: BumpMode = "line";
  /** Whether the embedded station screen (kds-board card) runs as an always-on ENROLLED display (no
   * login, one bound station) rather than the session-gated operator path. */
  @property({ type: Boolean }) deviceMode = false;
  /** The device station the app already probed at cold boot, handed to the embedded station screen so it
   * does not re-fetch on mount. */
  @property({ attribute: false }) initialDeviceStation?: DeviceStation;
  @property({ attribute: false }) tabLines: TabLine[] = [];
  @property({ attribute: false }) menus: TillMenu[] = [];
  @property() selectedMenuId = "";
  @property({ attribute: false }) selectedDiet: DietPredicate | null = null;
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  @property({ attribute: false }) courses: TillCourse[] = [];
  @property() orderId?: string;

  override render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === undefined) return nothing;
    return html`<div class="grid" style="grid-template-columns: repeat(${tab.columns}, 1fr)">
      ${tab.cards.filter((card) => this.#capable(card) && this.#visible(card)).map((card) => this.#cell(card))}
    </div>`;
  }

  /**
   * Advisory: it only ever removes a card. The server checks the integrated-card, print and drawer
   * capabilities on the operations themselves (`assertDeviceCapability`); no route checks `act-as-kds`
   * (apps/server/src/device-api.ts), so `kds-board`'s capability is checked here alone.
   */
  #capable(card: CardInstance): boolean {
    if (card.type === "tender-pay") return true; // cash path — never gated absent
    const required = CARD_REQUIRED_CAPABILITY[card.type];
    return required === undefined || this.capabilities.includes(required);
  }

  #locked(card: CardInstance): boolean {
    return CARD_REQUIRED_PERMISSION[card.type] === "venue.configure" && !this.canConfigureTill;
  }

  #cell(card: CardInstance): TemplateResult | typeof nothing {
    const element = this.#element(card);
    if (element === nothing) return nothing;
    const locked = this.#locked(card);
    return html`<div
      class="cell ${locked ? "locked" : ""}"
      ?inert=${locked}
      aria-disabled=${locked ? "true" : nothing}
      style="grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}"
    >
      ${element}
    </div>`;
  }

  /** No `default`: a card type without a case here is a compile error rather than a dropped card. */
  #element(card: CardInstance): TemplateResult | typeof nothing {
    switch (card.type) {
      case "product-grid": {
        // A missing or non-number value leaves the widget's responsive auto-fill default.
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
          .activeReaders=${this.activeReaders}
          .defaultReaderId=${this.defaultReaderId}
        ></till-tender-pay>`;
      case "held-orders":
        return html`<till-held-orders .orders=${this.heldOrders}></till-held-orders>`;
      case "prep-queue":
        return html`<till-station-queue
          .groups=${this.stationQueue}
          .view=${"rail"}
          .stationId=${this.defaultStationId}
        ></till-station-queue>`;
      case "floor-plan":
      case "table-layout-editor":
        return html`<till-floor-screen
          embedded
          .canEdit=${card.type === "table-layout-editor"}
          .zones=${this.zones}
          .tables=${this.tables}
          .api=${this.api}
          .canExitToCounter=${false}
        ></till-floor-screen>`;
      case "expo":
        return html`<till-expo-screen
          embedded
          .api=${this.api}
          .fireControl=${this.fireControl}
        ></till-expo-screen>`;
      case "kds-board":
        // Self-fetching: it reads its own station list and queue. `stationQueue` is the prep-queue
        // card's default-station data, not this display's station, so it is deliberately not passed.
        return html`<till-station-screen
          embedded
          .api=${this.api}
          .bumpMode=${this.bumpMode}
          .fireControl=${this.fireControl}
          .deviceMode=${this.deviceMode}
          .initialDeviceStation=${this.initialDeviceStation}
        ></till-station-screen>`;
      case "table-order":
        // `canSettle` is left the screen's DEFAULT `true` — a card-mounted tab settles like the standalone screen
        // (cash + manual-card tenders; the server fences only the integrated reader, `/api/pay`) — so it
        // is not passed.
        return html`<till-table-order-screen
          embedded
          .lines=${this.tabLines}
          .products=${this.products}
          .menus=${this.menus}
          .selectedMenuId=${this.selectedMenuId}
          .selectedDiet=${this.selectedDiet}
          .statuses=${this.statuses}
          .courses=${this.courses}
          .fireControl=${this.fireControl}
          .tables=${this.tables}
          .orderId=${this.orderId}
          .busy=${this.busy}
        ></till-table-order-screen>`;
      case "notifications":
        return nothing;
    }
  }

  /** Whether a card passes its `visibleWhen` data-condition gate (no gate ⇒ always shown). */
  #visible(card: CardInstance): boolean {
    const states = card.visibleWhen;
    if (states === undefined || states.length === 0) return true;
    const current = this.#currentState(card.type);
    // Fail OPEN when the host cannot compute this card's state (a self-fetching big card): a card the
    // host can't evaluate must not silently vanish.
    if (current === undefined) return true;
    return states.includes(current);
  }

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
