import { type DietPredicate, memoVisibleProducts, shownMenu } from "../menu-filter.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { HANDHELD_COLUMNS, TILL_COLUMNS } from "@waitron/catalogue/src/home-layout-columns.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
// Side-effect imports: registering each widget element so the switch below can render its tag.
import "./menu-browser.js";
import "./basket.js";
import "./total.js";
import "./tender-pay.js";
import "./held-orders.js";
import "./counter-waiting.js";
import "./station-queue.js";
import "../screens/till-floor-screen.js";
import "../screens/till-expo-screen.js";
import "../screens/till-station-screen.js";
import "../screens/till-table-order-screen.js";
import { CARD_REQUIRED_CAPABILITY, CARD_REQUIRED_PERMISSION } from "../layout.js";
import type { CapabilityFlag, CardInstance, CardType, TabDef } from "../layout.js";
import type {
  BillBalance,
  CounterWaitingOrder,
  CurrentOrders,
  DeviceStation,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  OrderGroup,
  PrintProblem,
  StationQueueGroup,
  TableServiceStatus,
  TableState,
  TableParty,
  TabLine,
  TillActiveReader,
  TillApi,
  TillCourse,
  TillProduct,
  TillZoneMenu,
  PartyBill,
} from "../api/client.js";
import type { BumpMode, FireControlMode } from "./station-queue.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { StoredLines } from "./basket.js";
import type { OtherDraft } from "../screens/till-table-order-screen.js";
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
    .pay-rest {
      display: flex;
      flex-direction: column;
      gap: var(--wt-space-3);
      margin-bottom: var(--wt-space-3);
      font-family: var(--wt-font-family);
      font-size: var(--wt-font-size-md);
      color: var(--wt-color-text);
    }
    .pay-rest p {
      margin: 0;
      font-weight: var(--wt-font-weight-bold);
    }
  `;

  @property({ attribute: false }) tab?: TabDef;
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The stored order in {@link store}, as the server lists its lines; see the basket's own. */
  @property({ attribute: false }) storedLines: StoredLines | null = null;
  /** A pay, place or hold of {@link store}'s order is out; see the basket's own. */
  @property({ type: Boolean }) orderInFlight = false;
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  /** Shown in the held-orders card, under the held orders. */
  @property({ attribute: false }) counterWaiting: CounterWaitingOrder[] = [];
  @property({ attribute: false }) stationQueue: StationQueueGroup[] = [];
  @property({ attribute: false }) defaultStationId?: string;
  @property({ type: Boolean }) busy = false;
  /** Holds payment: a line of this card's basket must be resolved first, or the basket's order has
   * a payment on it. Shuts only its own pay card, never a table's, whose lines are saved (D10). */
  @property({ type: Boolean }) payHeld = false;
  /** What the basket's order still owes when a payment is already on it: its pay card, held, is
   * offered with a way to take that as a bill payment, which the single payment refuses. */
  @property() payRest: string | null = null;
  @property() orderFlow: OrderFlow = "prepay";
  @property() stage: "order" | "collect" = "order";
  @property() cardProvider: CardProvider = "none";
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;
  @property({ attribute: false }) cardAttemptsOver = 0;
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
  @property({ attribute: false }) tabGroups: OrderGroup[] = [];
  @property({ attribute: false }) currentOrders: CurrentOrders | null = null;
  @property({ type: Boolean }) currentOrdersUnread = false;
  @property({ attribute: false }) printProblems: PrintProblem[] = [];
  @property({ attribute: false }) reprintSent: string[] = [];
  @property({ attribute: false }) tabRevision = 0;
  @property({ attribute: false }) editSentLines = true;
  @property({ attribute: false }) cancelOffer: number | null = null;
  @property({ attribute: false }) menus: TillZoneMenu[] = [];
  @property() selectedMenuId = "";
  @property({ attribute: false }) selectedDiet: DietPredicate | null = null;
  @property({ attribute: false }) statuses: TableServiceStatus[] = [];
  @property({ attribute: false }) courses: TillCourse[] = [];
  @property() orderId?: string;
  /** The open order's draft, passed through to the table-order card; see its `draftStore`. */
  @property({ attribute: false }) draftStore?: WorkingOrderStore | null;
  /** The other people's drafts on the order's party; see the table-order card's `otherDrafts`. */
  @property({ attribute: false }) otherDrafts: readonly OtherDraft[] = [];
  @property({ attribute: false }) takeOversAnswered = 0;
  @property({ attribute: false }) party: TableParty | null = null;
  @property({ attribute: false }) partyBills: PartyBill[] = [];
  /** The payments of the order's bill; see the table-order card's `billBalance`. */
  @property({ attribute: false }) billBalance: BillBalance | null = null;
  @property({ type: Boolean }) finishRefused = false;
  @property({ attribute: false }) nameRefusal: { name: string; message: string } | null = null;
  @property({ type: Boolean }) groupCommandBusy = false;
  /** A handheld form factor, whose menu browser shows fewer columns unless its card sets them. */
  @property({ type: Boolean }) handheld = false;
  /** The app opens a station's view from the floor: false on a device without one. */
  @property({ type: Boolean }) canOpenStation = false;

  readonly #browserProducts = memoVisibleProducts();

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

  /** Above the pay card, which {@link payHeld} holds: what the order still owes, and the offer to
   * take it as a bill payment. */
  #payRest(outstanding: string): TemplateResult {
    return html`<section class="pay-rest" data-counter-bill-payments>
      <p>
        ${t("table.bill_to_pay").replace("{amount}", () => formatMoney(outstanding, currentLocale()))}
      </p>
      <wt-button
        variant="primary"
        data-pay-rest
        .disabled=${this.busy}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("counter-bill-pay", {
              detail: { amount: outstanding },
              bubbles: true,
              composed: true,
            }),
          )}
      >
        ${t("bill.take_rest")}
      </wt-button>
    </section>`;
  }

  /** No `default`: a card type without a case here is a compile error rather than a dropped card. */
  #element(card: CardInstance): TemplateResult | typeof nothing {
    switch (card.type) {
      case "product-grid": {
        const configured = card.config.columns;
        const menu = shownMenu(this.menus, this.selectedMenuId);
        return html`<till-menu-browser
          .menu=${menu}
          .products=${this.#browserProducts(this.products, menu?.id ?? "", this.selectedDiet)}
          .store=${this.store}
          .columns=${
            typeof configured === "number"
              ? configured
              : this.handheld
                ? HANDHELD_COLUMNS
                : TILL_COLUMNS
          }
        ></till-menu-browser>`;
      }
      case "basket":
        return html`<till-basket
          .store=${this.store}
          .storedLines=${this.storedLines}
          .orderInFlight=${this.orderInFlight}
        ></till-basket>`;
      case "total":
        return html`<till-total .store=${this.store}></till-total>`;
      case "tender-pay":
        return html`${this.payRest === null ? nothing : this.#payRest(this.payRest)}<till-tender-pay
            .store=${this.store}
            .busy=${this.busy || this.payHeld}
            .mode=${this.orderFlow}
            .stage=${this.stage}
            .cardProvider=${this.cardProvider}
            .tipsEnabled=${this.tipsEnabled}
            .cardOutcome=${this.cardOutcome}
            .cardAttemptsOver=${this.cardAttemptsOver}
            .activeReaders=${this.activeReaders}
            .defaultReaderId=${this.defaultReaderId}
          ></till-tender-pay>`;
      case "held-orders":
        return html`<till-held-orders
            .orders=${this.heldOrders}
            .tables=${this.tables}
          ></till-held-orders
          ><till-counter-waiting .orders=${this.counterWaiting}></till-counter-waiting>`;
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
          .canOpenStation=${this.canOpenStation}
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
        // — so it is not passed.
        return html`<till-table-order-screen
          embedded
          .lines=${this.tabLines}
          .groups=${this.tabGroups}
          .currentOrders=${this.currentOrders}
          .currentOrdersUnread=${this.currentOrdersUnread}
          .printProblems=${this.printProblems}
          .reprintSent=${this.reprintSent}
          .revision=${this.tabRevision}
          .editSentLines=${this.editSentLines}
          .cancelOffer=${this.cancelOffer}
          .products=${this.products}
          .menus=${this.menus}
          .selectedMenuId=${this.selectedMenuId}
          .selectedDiet=${this.selectedDiet}
          .statuses=${this.statuses}
          .courses=${this.courses}
          .fireControl=${this.fireControl}
          .tables=${this.tables}
          .orderId=${this.orderId}
          .draftStore=${this.draftStore}
          .otherDrafts=${this.otherDrafts}
          .takeOversAnswered=${this.takeOversAnswered}
          .party=${this.party}
          .bills=${this.partyBills}
          .billBalance=${this.billBalance}
          .finishRefused=${this.finishRefused}
          .nameRefusal=${this.nameRefusal}
          .busy=${this.busy}
          .groupCommandBusy=${this.groupCommandBusy}
          .handheld=${this.handheld}
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
        return this.heldOrders.length > 0 || this.counterWaiting.length > 0
          ? "has-parked"
          : "empty";
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
