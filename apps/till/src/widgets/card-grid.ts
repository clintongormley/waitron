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
// The big-card screens (SP-B2.1): each self-registers its tag, mounted embedded (chrome-suppressed) by
// the switch below. Same side-effect-import-then-name-by-tag shape as the widgets above.
import "../screens/till-floor-screen.js";
import "../screens/till-expo-screen.js";
import { CARD_REQUIRED_CAPABILITY, CARD_REQUIRED_PERMISSION } from "../layout.js";
import type { CapabilityFlag, CardInstance, CardType, TabDef } from "../layout.js";
import type {
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  StationQueueGroup,
  TableState,
  TillApi,
  TillProduct,
} from "../api/client.js";
import type { FireControlMode } from "./station-queue.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { CardOutcome, CardProvider } from "./tender-pay.js";

/**
 * SP-B1 renderer: lays a layout-profile TAB's cards on a fluid grid (`repeat(columns, 1fr)`), each
 * card spanning colSpan×rowSpan. Every card is handed the SAME `store` (or an app-owned list), exactly
 * as the counter screen threads them today (`till-counter-screen.ts:267-307`); card events bubble past
 * this host to `till-app` unchanged — this host installs no listeners on them.
 *
 * All three visibility axes are honoured here (SP-B2.1): capability→absent (`#capable`),
 * permission→locked (`#locked`, a dimmed `?inert` cell), and `visibleWhen` (data-condition show/hide,
 * fail-open when the state is uncomputable). The `floor-plan`, `table-layout-editor` and `expo` big
 * cards render by mounting their screens EMBEDDED (chrome-suppressed); `kds-board`, `table-order` and
 * `notifications` render nothing here and arrive in B2.2/later.
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
  /** The device's granted capability flags — a card whose required capability is absent is skipped. */
  @property({ attribute: false }) capabilities: CapabilityFlag[] = [];
  /** The HTTP face of the till, threaded to the big-card screens (floor placement writes, expo levers). */
  @property({ attribute: false }) api?: TillApi;
  /** The venue's `fire_control` mode, threaded to the embedded expo screen's own `fireControl`. */
  @property() fireControl?: FireControlMode;
  /** The venue's floor zones, threaded to the embedded floor screen (the app owns and refreshes them). */
  @property({ attribute: false }) zones: FloorZone[] = [];
  /** The live-floor occupancy read-model, threaded to the embedded floor screen. */
  @property({ attribute: false }) tables: TableState[] = [];
  /** Whether this operator may configure the till — the sole permission gating a card (table-layout-editor). */
  @property({ type: Boolean }) canConfigureTill = false;

  override render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === undefined) return nothing;
    return html`<div class="grid" style="grid-template-columns: repeat(${tab.columns}, 1fr)">
      ${tab.cards.filter((card) => this.#capable(card) && this.#visible(card)).map((card) => this.#cell(card))}
    </div>`;
  }

  /**
   * Capability→ABSENT (spec §5.1). tender-pay is sale-critical + takes cash → ALWAYS rendered.
   *
   * This client gate is ADVISORY (SP-B2.1 follow-up c): it only ever REMOVES a card the device is not
   * equipped for — it can never WIDEN access, because a truthy result is a necessary-not-sufficient
   * condition for a card to render. What actually fences access is the SERVER, which independently guards
   * the two capability-bearing OPERATIONS via `assertDeviceCapability`
   * (`apps/server/src/device-session.ts:359`): the integrated-card payment for the "pay" action
   * (`apps/server/src/till-api.ts:849`) and the cash-drawer open for "drawer_open"
   * (`apps/server/src/till-api.ts:1294`). So a card that leads to ONE OF THOSE TWO operations, if shown
   * through a bug or a stale profile, still cannot perform it — those two endpoints fail CLOSED
   * regardless of what the grid rendered. The third capability, `act-as-kds` (the only one this gate
   * actually consults, since tender-pay short-circuits above), has no live server enforcement in B2.1
   * (comment-only at `apps/server/src/device-api.ts:256`); its one card, `kds-board`, renders `nothing`
   * here and is wrapped in B2.2, so no reachable card relies on the advisory gate alone today.
   */
  #capable(card: CardInstance): boolean {
    if (card.type === "tender-pay") return true; // cash path — never gated absent
    const required = CARD_REQUIRED_CAPABILITY[card.type];
    return required === undefined || this.capabilities.includes(required);
  }

  /**
   * Permission→LOCKED (spec §5.2). Only `till.configure` (on `table-layout-editor`) exists in the
   * catalogue, so this can only ever be true for that card — never for a sale-critical card
   * (product-grid/basket/total/tender-pay carry no required permission).
   */
  #locked(card: CardInstance): boolean {
    return CARD_REQUIRED_PERMISSION[card.type] === "till.configure" && !this.canConfigureTill;
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
      // Big-card screens (SP-B2.1), each mounted EMBEDDED so it renders only its BODY — its own header
      // and Back are suppressed, and navigation chrome comes from the tab shell / drill-in host, not
      // from this grid cell (the cell itself draws no title/close). `.canExitToCounter=${false}` keeps a stray back-to-counter
      // from escaping the tab shell. The floor screen serves both the read-only floor-plan card and the
      // manager's table-layout-editor card — the latter with `canEdit`. The table-layout-editor card's
      // permission LOCK (till.configure) is enforced by `#locked`/`.cell.locked` at the CELL level above,
      // not here. `canEdit` is @property({ attribute: false }) on the floor screen, so it must be set as a
      // PROPERTY (`.canEdit=`), never a bare attribute — a bare `canEdit` would not reach it. The
      // read-only floor-plan card mounts the SAME screen without edit; the two arms differ only by `canEdit`.
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
      // These arrive in B2.2/later — still not rendered on any tab yet.
      case "notifications":
      case "kds-board":
      case "table-order":
        return nothing;
    }
  }

  /** Whether a card passes its `visibleWhen` data-condition gate (no gate ⇒ always shown). */
  #visible(card: CardInstance): boolean {
    const states = card.visibleWhen;
    if (states === undefined || states.length === 0) return true;
    const current = this.#currentState(card.type);
    // Fail OPEN when the host cannot compute this card's state (e.g. a self-fetching big card): a card
    // the host can't evaluate must not silently vanish (SP-B2.1 follow-up d). Cards the host CAN compute
    // (held-orders, prep-queue) still hide when their state is out of the list.
    if (current === undefined) return true;
    return states.includes(current);
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
