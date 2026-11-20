import "../widgets/set-menu-counts.js";
import type { ChangeAvailability, ChangeOptionAvailability } from "../widgets/product-info.js";
import { servicePeriod, servicePeriodStyles } from "../widgets/service-period.js";
import type { MenuState } from "../api/client.js";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, floorChipStyles } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import { StoreChangeController } from "../state/store-controller.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  type MenuFilters,
  EMPTY_MENU_FILTERS,
  memoVisibleProducts,
  shownMenu,
} from "../menu-filter.js";
import {
  centsToDecimal,
  formatMoney,
  sumDecimals,
  type BillSetMenuState,
  type DishMove,
} from "@waitron/shared";
import {
  NO_ORDERING_COPIES,
  draftPlacementId,
  draftPlacements,
  menusWithCopies,
  sentMenuDishes,
  type OrderingCopy,
} from "../state/set-menus.js";
import { lineGross } from "../state/order-line.js";
import { lineProductName } from "../widgets/product-name.js";
import { PHONE_WIDTH } from "../widgets/chooser-styles.js";
import "../widgets/menu-browser.js";
import "../widgets/basket.js";
import "../widgets/last-added.js";
import "../widgets/total.js";
import "../widgets/tender-pay.js";
import "../widgets/held-orders.js";
import "../widgets/counter-waiting.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import { diningControl, diningShown } from "../widgets/dining-choice.js";
import type {
  CounterWaitingOrder,
  DiningChoice,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  ServiceZoneSummary,
  Station,
  TableState,
  TillActiveReader,
  TillApi,
  TillProduct,
  TillZoneMenu,
} from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { StoredLines } from "../widgets/basket.js";
import type { CollectCardDetail, CardOutcome, CardProvider } from "../widgets/tender-pay.js";

@customElement("till-counter-screen")
export class TillCounterScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
    new StoreChangeController(this, () => this.store);
  }

  static override styles = [
    baseStyles,
    servicePeriodStyles,
    floorChipStyles,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .screen {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .body.grid-body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        padding: var(--wt-space-4);
        flex: 1;
        min-height: 0;
      }

      .menu-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .dining,
      [data-dining-label] {
        margin: var(--wt-space-2);
      }

      .menu-controls till-menu-switcher::part(options) {
        margin-bottom: 0;
      }

      .sale-grid {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) auto auto;
        gap: var(--wt-space-3);
        flex: 1;
        min-height: 0;
      }
      .sale-grid > div {
        min-width: 0;
        min-height: 0;
      }
      .menu-cell {
        grid-column: 1;
        grid-row: 1 / span 3;
        overflow: auto;
        /* Room inside the scrolling box for a help badge hung over its first part's top corner. */
        padding-block-start: calc(var(--wt-help-badge-target) / 2);
      }
      .menu-column {
        grid-column: 1;
        grid-row: 1 / span 3;
        display: flex;
        flex-direction: column;
        min-height: 0;
        gap: var(--wt-space-2);
      }
      .menu-column .menu-cell {
        flex: 1;
        min-height: 0;
      }
      .basket-cell {
        background: var(--wt-color-surface);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-border);
        grid-column: 2;
        grid-row: 1;
        overflow: auto;
      }
      .total-cell {
        grid-column: 2;
        grid-row: 2;
      }
      .payment-cell {
        grid-column: 2;
        grid-row: 3;
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

      @media ${unsafeCSS(PHONE_WIDTH)} {
        :host,
        .screen {
          height: auto;
        }

        .body.grid-body {
          padding-inline: 0;
        }
        .sale-grid {
          display: flex;
          flex-direction: column;
          flex: none;
        }
        .menu-cell,
        .basket-cell {
          overflow: visible;
        }
        .menu-cell {
          padding-block-start: 0;
        }
        .basket-cell {
          border-inline-start: 0;
          border-block-start: var(--wt-space-1) solid var(--wt-color-border);
        }
      }
    `,
  ];

  @property({ attribute: false }) changeAvailability?: ChangeAvailability;
  @property({ attribute: false }) changeOptionAvailability?: ChangeOptionAvailability;
  @property({ attribute: false }) api!: TillApi;
  /** Set before the element connects. */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The stored order in {@link store}, as the server lists its lines; see the basket's own. */
  @property({ attribute: false }) storedLines: StoredLines | null = null;
  /** Collection withholds the adjustment listing; declaration display still needs these rows. */
  @property({ attribute: false }) nutritionLines: StoredLines | null = null;
  @property({ attribute: false }) stationMoveLines: StoredLines | null = null;
  @property({ attribute: false }) makeAtStations: Station[] = [];
  /** A pay, place or hold of {@link store}'s order is out; see the basket's own. */
  @property({ type: Boolean }) orderInFlight = false;
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) menus: TillZoneMenu[] = [];
  @property({ attribute: false }) service: MenuState["service"] | null = {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    zoneKeepOpen: null,
    keepOpen: null,
  };
  @property() departmentName = "";
  @property({ attribute: false })
  receiptEquipment?: import("../api/client.js").RoleEquipment["resolved"];
  @property() zoneName = "";
  /** Owned by the app; a switcher pick bubbles up as `menu-selected` for it to update. */
  @property() selectedMenuId = "";
  @property({ type: Boolean }) menuSelectionRequired = false;
  @property({ attribute: false }) serviceZones: ServiceZoneSummary[] = [];
  @property() selectedServiceZoneId = "";
  @property({ attribute: false }) orderList: "parked" | "waiting" | null = null;
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  @property({ attribute: false }) counterWaiting: CounterWaitingOrder[] = [];
  /** The floor, which a held order's Move to table lists. */
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ attribute: false }) zones: FloorZone[] = [];
  @property() orderFlow: OrderFlow = "prepay";
  @property() stage: "order" | "collect" = "order";
  @property({ type: Boolean }) paymentWindow = false;
  @property() invoiceLocale = "es-ES";

  @property({ attribute: false }) selectedFilters: MenuFilters = EMPTY_MENU_FILTERS;
  /** A sale or order is being sent: the visible half of the app's guard against a second send. */
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) sendingTender: "cash" | "card" | "pay" | null = null;
  /** Holds payment: a basket line must be resolved first, or the retrieved order has a payment on it. */
  @property({ type: Boolean }) payHeld = false;
  /** Outstanding amount offered through the bill-payment flow. */
  @property() payRest: string | null = null;
  @property() cardProvider: CardProvider = "none";
  /** See the tender card's `takesCash`. */
  @property({ type: Boolean }) takesCash = true;
  @property({ type: Boolean }) takesManualCard = false;
  /** See the waiting list's `canMoveStation`. */
  @property({ type: Boolean }) canMoveStation = false;
  @property({ type: Boolean }) canEditKitchenNote = false;
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;
  @property({ attribute: false }) cardRetryDetail?: CollectCardDetail;
  @property({ attribute: false }) cardAttemptsOver = 0;
  @property({ type: Boolean }) sumUpConnected = false;

  @property({ type: Boolean }) slipPrinterAvailable = false;
  @property({ attribute: false }) activeReaders: TillActiveReader[] = [];
  @property() defaultReaderId?: string;
  @property({ attribute: false }) receiptLanguages: string[] = [];
  @property({ type: Boolean }) fullInvoices = false;
  @property() receiptLanguage = "";
  @property({ type: Boolean }) asksGuests = false;
  @property({ attribute: false }) receiptGuests: number | null = null;
  /** Whether the server still lets {@link store}'s saved order switch its way; ignored while the
   * order is an unsaved draft, and read as `"none"` when not known. */
  @property({ attribute: false }) diningChoice: DiningChoice | null = null;
  /** A handheld form factor, whose menu browser shows the menu's handheld display. */
  @property({ type: Boolean }) handheld = false;
  @property({ attribute: false }) setMenuBill?: BillSetMenuState;
  @property({ attribute: false }) setMenuCopies: readonly OrderingCopy[] = NO_ORDERING_COPIES;
  @property({ attribute: false }) setMenuCourses: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) saveSetMenuCount?: (
    menuId: string,
    count: number,
  ) => Promise<string | undefined>;

  @property({ attribute: false }) moveSetMenuDishes?: (
    moves: readonly DishMove[],
  ) => Promise<string | undefined>;

  #addSetMenu = (menuId: string): Promise<string | undefined> => {
    const count =
      this.setMenuBill === undefined
        ? 0
        : menusWithCopies(this.setMenuBill).filter(({ copy }) => copy.setMenuId === menuId).length;
    return this.saveSetMenuCount?.(menuId, count + 1) ?? Promise.resolve(undefined);
  };

  readonly #browserProducts = memoVisibleProducts();
  readonly #searchProducts = memoVisibleProducts();
  readonly #unfilteredProducts = memoVisibleProducts();
  readonly #unfilteredSearchProducts = memoVisibleProducts();

  #pickFilters(filters: MenuFilters): void {
    this.selectedFilters = filters;
  }

  #menuControls(): TemplateResult {
    return html`
      ${this.service?.open === true && this.service.zoneOpen && !this.menus.some((menu) => menu.orderable) ? html`<p role="status" data-last-orders-ended>${t("menu.last_orders_ended")}</p>` : nothing}
      ${
        this.service?.open === true && this.service.zoneOpen
          ? html`<till-menu-switcher
              class="menu-switcher"
              .menus=${this.menus}
              .selectedId=${this.selectedMenuId}
            ></till-menu-switcher>`
          : nothing
      }
    `;
  }

  #menu(): TemplateResult | typeof nothing {
    const open = this.service?.open === true && this.service.zoneOpen;
    const menu = !open
      ? undefined
      : this.menuSelectionRequired
        ? this.menus.find((menu) => menu.id === this.selectedMenuId && menu.orderable)
        : shownMenu(this.menus, this.selectedMenuId);
    const copies =
      this.stage === "order" && this.store.dining === "takeaway" && open
        ? this.setMenuCopies
        : NO_ORDERING_COPIES;
    if (menu === undefined && copies.length === 0) return nothing;
    const served = this.products.filter((product) =>
      this.menus.some((each) => each.id === product.menuId && each.orderable),
    );
    return html`<till-menu-browser
      .changeAvailability=${this.changeAvailability}
      .changeOptionAvailability=${this.changeOptionAvailability}
      .menu=${menu}
      .setMenuBill=${copies.length === 0 ? undefined : this.setMenuBill}
      .setMenuCopies=${copies}
      .setMenuCourses=${this.setMenuCourses}
      .addSetMenu=${this.#addSetMenu}
      .moveSetMenuDishes=${this.moveSetMenuDishes}
      .setMenuDishNames=${new Map(
        this.store.lines.flatMap((line) =>
          line.setMenuId === undefined || line.workingOrderLineId === undefined
            ? []
            : [[line.workingOrderLineId, lineProductName(line.product)]],
        ),
      )}
      .filters=${this.selectedFilters}
      .products=${this.#browserProducts(this.products, menu?.id ?? "", this.selectedFilters)}
      .unfilteredProducts=${this.#unfilteredProducts(this.products, menu?.id ?? "", EMPTY_MENU_FILTERS)}
      .menus=${this.menus}
      .servedProducts=${this.#searchProducts(served, "", this.selectedFilters)}
      .unfilteredServedProducts=${this.#unfilteredSearchProducts(served, "", EMPTY_MENU_FILTERS)}
      .store=${this.store}
      .handheld=${this.handheld}
      ><till-diet-filter
        slot="filters"
        .selected=${this.selectedFilters}
        @menu-filters-selected=${(e: CustomEvent<{ filters: MenuFilters }>) => this.#pickFilters(e.detail.filters)}
      ></till-diet-filter
    ></till-menu-browser>`;
  }

  #setMenuPrices() {
    const bill = this.setMenuBill;
    if (!bill?.setMenus.length) return {};
    const lines = this.store.lines;
    const saved = sentMenuDishes(bill);
    const draft = new Map(
      draftPlacements(bill, lines).placed.map(({ id, priceCents }) => [
        id,
        centsToDecimal(priceCents),
      ]),
    );
    const byLine = new Map(
      lines.map((line, index) => [
        line,
        line.workingOrderLineId === undefined
          ? draft.get(draftPlacementId(line, index))
          : saved.get(line.workingOrderLineId)?.price,
      ]),
    );
    return {
      placedPrice: (line: (typeof lines)[number]) => byLine.get(line),
      total: sumDecimals([
        ...menusWithCopies(bill).map(({ copy }) => centsToDecimal(copy.priceCents)),
        ...lines.map((line) => {
          const price = byLine.get(line);
          return lineGross(
            price === undefined
              ? line
              : { ...line, product: { ...line.product, unitPrice: price } },
          );
        }),
      ]),
    };
  }

  #lists(): TemplateResult | typeof nothing {
    if (this.orderList === null) return nothing;
    const orders = this.heldOrders.some((order) => order.id === this.store.id)
      ? this.heldOrders.filter((order) => order.id !== this.store.id)
      : this.heldOrders;
    return this.orderList === "parked"
      ? html`<till-held-orders
          .orders=${orders}
          .tables=${this.tables}
          .zones=${this.zones}
        ></till-held-orders>`
      : this.counterWaiting.length === 0
        ? html`<p role="status">${t("shell.waiting_empty")}</p>`
        : html`<till-counter-waiting
            .orders=${this.counterWaiting}
            .canEditKitchenNote=${this.canEditKitchenNote}
            .canMoveStation=${this.canMoveStation}
          ></till-counter-waiting>`;
  }

  #takeRest(outstanding: string): TemplateResult {
    return html`<section class="pay-rest" data-counter-bill-payments>
      <p>
        ${t("table.bill_to_pay").replace("{amount}", () => formatMoney(outstanding, currentLocale()))}
      </p>
    </section>`;
  }

  #gridBody(): TemplateResult {
    const { placedPrice, total } = this.#setMenuPrices();
    return html`<div class="body grid-body">
      ${servicePeriod(this.service, this.departmentName, this.api, this.selectedServiceZoneId, this.zoneName, this.receiptEquipment)}
      <div class="sale-grid">
        <div class="menu-column">
          <div class="menu-cell">
            ${
              this.orderList === null
                ? html`<div class="menu-controls">${this.#menuControls()}</div>
                    ${this.#menu()}`
                : this.#lists()
            }
          </div>
          ${this.store.lastAdded === undefined ? nothing : html`<till-last-added .store=${this.store} .disabled=${this.busy || this.orderInFlight} .readOnly=${this.stage === "collect"} @open-line-details=${(event: CustomEvent<{ line: import("../state/working-order.js").OrderLine }>) => this.shadowRoot!.querySelector("till-basket")?.openLineDetails(event.detail.line)}></till-last-added>`}
        </div>
        <div class="basket-cell">
          ${diningControl(
            diningShown(
              this.store.dining,
              this.store.persisted ? (this.diningChoice ?? "none") : null,
              this.store.diningStart,
            ),
            this,
            this.stage === "collect" || this.busy || this.orderInFlight,
          )}
          ${
            this.stage === "order" &&
            this.store.dining === "takeaway" &&
            this.setMenuCopies.length > 0
              ? html`<till-set-menu-counts
                  .bill=${this.setMenuBill ?? null}
                  .draft=${this.store.lines}
                  .onSale=${this.setMenuCopies.map(({ copy }) => copy)}
                  .busy=${this.store.editsLocked || this.busy || this.orderInFlight}
                  .saveCount=${this.saveSetMenuCount}
                ></till-set-menu-counts>`
              : nothing
          }
          <till-basket
            stacked
            .store=${this.store}
            .placedPrice=${placedPrice}
            .lineDetails=${true}
            .revealAdded=${true}
            .allowPickRemoval=${true}
            .draftParent=${this}
            .readOnly=${this.stage === "collect"}
            .storedLines=${this.storedLines}
            .nutritionLines=${this.nutritionLines}
            .stationMoveLines=${this.stationMoveLines}
            .makeAtStations=${this.makeAtStations}
            .orderInFlight=${this.orderInFlight}
          ></till-basket>
        </div>
        <div class="total-cell">
          <till-total .store=${this.store} .previewTotal=${total}></till-total>
        </div>
        <div class="payment-cell">
          ${this.payRest === null ? nothing : this.#takeRest(this.payRest)}<till-tender-pay
            .filters=${this.selectedFilters}
            .paymentWindow=${this.stage === "order" || this.paymentWindow}
            .store=${this.store}
            .hasSetMenus=${(this.setMenuBill?.setMenus.length ?? 0) > 0}
            .sendingTender=${this.sendingTender}
            .busy=${this.busy || this.payHeld}
            .held=${this.payHeld && !this.busy}
            .mode=${this.orderFlow}
            .stage=${this.stage}
            .cardProvider=${this.cardProvider}
            .takesCash=${this.takesCash}
            .takesManualCard=${this.takesManualCard}
            .tipsEnabled=${this.tipsEnabled}
            .cardOutcome=${this.cardOutcome}
            .cardRetryDetail=${this.cardRetryDetail}
            .cardAttemptsOver=${this.cardAttemptsOver}
            .sumUpConnected=${this.sumUpConnected}
            .activeReaders=${this.activeReaders}
            .defaultReaderId=${this.defaultReaderId}
            .receiptLanguages=${this.receiptLanguages}
            .fullInvoices=${this.fullInvoices}
            .receiptLanguage=${this.receiptLanguage}
            .asksGuests=${this.asksGuests}
            .receiptGuests=${this.receiptGuests}
          ></till-tender-pay>
        </div>
      </div>
    </div>`;
  }

  override render() {
    return html`<div class="screen">${this.#gridBody()}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-screen": TillCounterScreen;
  }
}
