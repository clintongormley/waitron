import type { MenuState } from "../api/client.js";
import { type DietPredicate, memoVisibleProducts, shownMenu } from "../menu-filter.js";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
import { kitchenScreenSwitchedText, type KitchenScreenNotice } from "../kitchen-screen-notice.js";
import type { CapabilityFlag, CardInstance, CardType, TabDef } from "../layout.js";
import type {
  BillBalance,
  CounterWaitingOrder,
  CurrentOrders,
  DeviceStationScreen,
  DevicePassMonitor,
  DevicePassScreen,
  FloorZone,
  HeldOrderSummary,
  KitchenScreenKind,
  OrderFlow,
  OrderGroup,
  PrintProblem,
  Station,
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
import { PHONE_WIDTH } from "./language-chooser-styles.js";

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
    /* A phone is too narrow for any card to share a row, so the cards stack full width in the tab's
       order and the page scrolls. !important because the tab's columns and spans are inline. */
    @media ${unsafeCSS(PHONE_WIDTH)} {
      .grid {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-auto-rows: auto;
        height: auto;
      }
      .cell {
        grid-column: auto !important;
        grid-row: auto !important;
      }
    }
    .sale-grid {
      grid-template-rows: minmax(0, 1fr) auto auto;
      grid-auto-rows: auto;
    }
    .sale-grid .cell[data-card="product-grid"] {
      grid-row: 1 / span 3 !important;
      overflow: auto;
    }
    .sale-grid .cell[data-card="basket"] {
      grid-row: 1 !important;
      overflow: auto;
    }
    .sale-grid .cell[data-card="total"] {
      grid-row: 2 !important;
    }
    .sale-grid .cell[data-card="tender-pay"] {
      grid-row: 3 !important;
    }
    @media ${unsafeCSS(PHONE_WIDTH)} {
      .sale-grid {
        grid-template-rows: none;
      }
      .sale-grid .cell[data-card] {
        grid-row: auto !important;
        overflow: visible;
      }
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
    .kitchen-screen {
      display: flex;
      flex-direction: column;
      gap: var(--wt-space-2);
      padding: var(--wt-space-6);
      font-family: var(--wt-font-family);
      font-size: var(--wt-font-size-lg);
      color: var(--wt-color-text);
    }
    .kitchen-screen p {
      margin: 0;
    }
    .switched {
      margin: var(--wt-space-4) var(--wt-space-4) 0;
      padding: var(--wt-space-3);
      border: 1px solid var(--wt-color-border);
      border-radius: var(--wt-radius-md);
      background: var(--wt-color-surface-raised);
      color: var(--wt-color-text);
      font-family: var(--wt-font-family);
      font-size: var(--wt-font-size-lg);
      font-weight: var(--wt-font-weight-bold);
    }
  `;

  @property({ attribute: false }) tab?: TabDef;
  @property({ type: Boolean }) fitSale = false;
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The stored order in {@link store}, as the server lists its lines; see the basket's own. */
  @property({ attribute: false }) storedLines: StoredLines | null = null;
  @property({ attribute: false }) makeAtStations: Station[] = [];
  @property({ attribute: false }) stations: Station[] = [];
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
  /** See the tender card's `takesCash`. */
  @property({ type: Boolean }) takesCash = true;
  @property({ type: Boolean }) canMoveStation = false;
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
  @property({ attribute: false }) permissions: string[] = [];
  @property() bumpMode: BumpMode = "line";
  /** Whether the embedded station screen (kds-board card) runs as an always-on ENROLLED display (no
   * login, the device's own station screen) rather than the session-gated operator path. */
  @property({ type: Boolean }) deviceMode = false;
  /** The device station the app already probed at cold boot, handed to the embedded station screen so it
   * does not re-fetch on mount. */
  @property({ attribute: false }) initialDeviceStation?: DeviceStationScreen;
  @property({ attribute: false }) deviceId?: string;
  @property({ attribute: false }) initialDevicePass?: DevicePassScreen;
  @property({ attribute: false }) initialDevicePassMonitor?: DevicePassMonitor;
  /** The kitchen display's name, its pass screen's title. */
  @property({ attribute: false }) deviceName?: string;
  /** Shown on the kds-board card in place of a queue. */
  @property({ attribute: false }) kitchenScreenNotice?: KitchenScreenNotice;
  /** Said above the kds-board card's board after a refused press switched it. */
  @property({ attribute: false }) kitchenScreenSwitched?: KitchenScreenKind;
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
  @property({ attribute: false }) service: MenuState["service"] | null = {
    open: true,
    zoneOpen: true,
    periodName: null,
    zoneKeepOpen: null,
    keepOpen: null,
  };
  @property() zoneId = "";
  @property() departmentName = "";
  @property() zoneName = "";
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
  /** A handheld form factor, whose menu browser shows the menu's handheld display. */
  @property({ type: Boolean }) handheld = false;
  /** The app opens a station's view from the floor: false on a device without one. */
  @property({ type: Boolean }) canOpenStation = false;

  /** On a phone the basket stacks each line's name above its controls. */
  @state() private phone = false;
  #phoneWidth?: MediaQueryList;
  readonly #onPhoneWidth = (event: MediaQueryListEvent) => {
    this.phone = event.matches;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#phoneWidth = window.matchMedia(PHONE_WIDTH);
    this.phone = this.#phoneWidth.matches;
    this.#phoneWidth.addEventListener("change", this.#onPhoneWidth);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#phoneWidth?.removeEventListener("change", this.#onPhoneWidth);
    this.#phoneWidth = undefined;
  }

  readonly #browserProducts = memoVisibleProducts();
  readonly #searchProducts = memoVisibleProducts();
  readonly #unfilteredProducts = memoVisibleProducts();
  readonly #unfilteredSearchProducts = memoVisibleProducts();

  override render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === undefined) return nothing;
    const [menu, basket, total, pay, ...rest] = tab.cards;
    const saleGrid =
      this.fitSale &&
      menu?.type === "product-grid" &&
      basket?.type === "basket" &&
      total?.type === "total" &&
      pay?.type === "tender-pay" &&
      menu.colSpan + basket.colSpan === tab.columns &&
      total.colSpan === basket.colSpan &&
      pay.colSpan === basket.colSpan &&
      rest.every((card) => card.type === "held-orders" && card.colSpan === menu.colSpan);
    const cards = tab.cards.filter((card) => this.#capable(card) && this.#visible(card));
    const groupHeld = saleGrid && !this.phone;
    const heldCards = groupHeld ? cards.filter((card) => card.type === "held-orders") : [];
    const gridCards = groupHeld ? cards.filter((card) => card.type !== "held-orders") : cards;
    return html`${saleGrid ? nothing : html`<slot name="menu-controls"></slot>`}
      <div
        class="grid ${saleGrid ? "sale-grid" : ""}"
        style="grid-template-columns: repeat(${tab.columns}, 1fr)"
      >
        ${gridCards.map((card) => this.#cell(card, saleGrid, card.type === "product-grid" ? heldCards : []))}
      </div>`;
  }

  /**
   * Advisory: it only ever removes a card. The server checks profile actions on the routes the map
   * in `apps/server/src/till-api.profile-actions.test.ts` lists; `act-as-kds` is a screen, which no
   * route checks, so `kds-board`'s capability is checked here alone.
   */
  #capable(card: CardInstance): boolean {
    if (card.type === "tender-pay") return true; // it hides cash itself, and always offers card
    const required = CARD_REQUIRED_CAPABILITY[card.type];
    return required === undefined || this.capabilities.includes(required);
  }

  #locked(card: CardInstance): boolean {
    const required = CARD_REQUIRED_PERMISSION[card.type];
    return required !== undefined && !this.permissions.includes(required);
  }

  #cell(
    card: CardInstance,
    saleGrid: boolean,
    following: CardInstance[],
  ): TemplateResult | typeof nothing {
    const element = this.#element(card);
    if (element === nothing) return nothing;
    const locked = this.#locked(card);
    return html`<div
      class="cell ${locked ? "locked" : ""}"
      data-card=${card.type}
      ?inert=${locked}
      aria-disabled=${locked ? "true" : nothing}
      style="grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}"
    >
      ${saleGrid && card.type === "product-grid" ? html`<slot name="menu-controls"></slot>` : nothing}
      ${element} ${following.map((card) => this.#cell(card, false, []))}
    </div>`;
  }

  #kdsBoard(): TemplateResult {
    if (this.kitchenScreenNotice !== undefined)
      return html`<till-kitchen-screen-notice
        class="kitchen-screen"
        role="status"
        .api=${this.api}
        .notice=${this.kitchenScreenNotice}
      ></till-kitchen-screen-notice>`;
    if (this.initialDevicePassMonitor)
      return html`<till-expo-screen
        embedded
        monitor
        .api=${this.api}
        .deviceMode=${this.deviceMode}
        .deviceName=${this.deviceName}
        .initialDevicePassMonitor=${this.initialDevicePassMonitor}
      ></till-expo-screen>`;
    // Self-fetching: it reads its own station list and queue. `stationQueue` is the prep-queue
    // card's default-station data, not this display's station, so it is deliberately not passed.
    return this.initialDevicePass
      ? html`<till-expo-screen
          embedded
          .api=${this.api}
          .fireControl=${this.fireControl}
          .runsPass=${this.capabilities.includes("run-the-pass")}
          .deviceMode=${this.deviceMode}
          .deviceName=${this.deviceName}
          .initialDevicePass=${this.initialDevicePass}
        ></till-expo-screen>`
      : html`<till-station-screen
          embedded
          .api=${this.api}
          .bumpMode=${this.bumpMode}
          .fireControl=${this.fireControl}
          .deviceMode=${this.deviceMode}
          .initialDeviceStation=${this.initialDeviceStation}
          .deviceId=${this.deviceId}
          .canMoveStation=${this.canMoveStation}
        ></till-station-screen>`;
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
        if (this.service?.open !== true || !this.service.zoneOpen) return nothing;
        const configured = card.config.columns;
        const menu = shownMenu(this.menus, this.selectedMenuId);
        if (menu === undefined) return nothing;
        return html`<till-menu-browser
          .menu=${menu}
          .products=${this.#browserProducts(this.products, menu?.id ?? "", this.selectedDiet)}
          .unfilteredProducts=${this.#unfilteredProducts(this.products, menu?.id ?? "", null)}
          .menus=${this.menus}
          .servedProducts=${this.#searchProducts(
            this.products.filter((product) =>
              this.menus.some((menu) => menu.id === product.catalogueId && menu.orderable),
            ),
            "",
            this.selectedDiet,
          )}
          .unfilteredServedProducts=${this.#unfilteredSearchProducts(
            this.products.filter((product) =>
              this.menus.some((menu) => menu.id === product.catalogueId && menu.orderable),
            ),
            "",
            null,
          )}
          .store=${this.store}
          .columns=${typeof configured === "number" ? configured : undefined}
          .handheld=${this.handheld}
        ></till-menu-browser>`;
      }
      case "basket":
        return html`<till-basket
          ?stacked=${this.phone}
          .store=${this.store}
          .storedLines=${this.storedLines}
          .makeAtStations=${this.makeAtStations}
          .orderInFlight=${this.orderInFlight}
        ></till-basket>`;
      case "total":
        return html`<till-total .store=${this.store}></till-total>`;
      case "tender-pay":
        return html`${this.payRest === null ? nothing : this.#payRest(this.payRest)}<till-tender-pay
            .store=${this.store}
            .busy=${this.busy || this.payHeld}
            .held=${this.payHeld && !this.busy}
            .mode=${this.orderFlow}
            .stage=${this.stage}
            .cardProvider=${this.cardProvider}
            .takesCash=${this.takesCash}
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
          ><till-counter-waiting
            .orders=${this.counterWaiting}
            .canMoveStation=${this.canMoveStation}
          ></till-counter-waiting>`;
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
          .runsPass=${this.capabilities.includes("run-the-pass")}
        ></till-expo-screen>`;
      case "kds-board":
        return html`${
          this.kitchenScreenSwitched === undefined
            ? nothing
            : html`<p class="switched" role="status" data-screen-switched>
                ${kitchenScreenSwitchedText(this.kitchenScreenSwitched)}
              </p>`
        }${this.#kdsBoard()}`;
      case "table-order":
        // `canSettle` is left the screen's DEFAULT `true` — a card-mounted tab settles like the standalone screen
        // — so it is not passed.
        return html`<till-table-order-screen
          .api=${this.api}
          .zoneId=${this.zoneId}
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
          .service=${this.service}
          .departmentName=${this.departmentName}
          .zoneName=${this.zoneName}
          .selectedMenuId=${this.selectedMenuId}
          .selectedDiet=${this.selectedDiet}
          .statuses=${this.statuses}
          .courses=${this.courses}
          .stations=${this.stations}
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
          .takesCash=${this.takesCash}
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
