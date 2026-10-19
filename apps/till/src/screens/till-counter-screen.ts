import { servicePeriod, servicePeriodStyles } from "../widgets/service-period.js";
import type { MenuState } from "../api/client.js";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-language-chooser.js";
import { currentLocale, t } from "../i18n/t.js";
import { StoreChangeController } from "../state/store-controller.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  type MenuFilters,
  EMPTY_MENU_FILTERS,
  memoVisibleProducts,
  shownMenu,
} from "../menu-filter.js";
import { formatMoney } from "@waitron/shared";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { MediaQueryController } from "../state/media-query-controller.js";
import { languageChooserStyles } from "../widgets/language-chooser-styles.js";
import "../widgets/menu-browser.js";
import "../widgets/basket.js";
import "../widgets/total.js";
import "../widgets/tender-pay.js";
import "../widgets/held-orders.js";
import "../widgets/counter-waiting.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import type {
  CounterWaitingOrder,
  FloorZone,
  HeldOrderSummary,
  OrderFlow,
  ServiceZoneSummary,
  Station,
  StationQueueGroup,
  TableState,
  TillActiveReader,
  TillApi,
  TillProduct,
  TillZoneMenu,
} from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { StoredLines } from "../widgets/basket.js";
import type { CollectCardDetail, CardOutcome, CardProvider } from "../widgets/tender-pay.js";

/** A brand wordmark is a fixed name, not translated UI copy. */
const BRAND = "Waitron";

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
    languageChooserStyles,
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

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3) var(--wt-space-4);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .brand {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .session {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .operator {
        font-weight: var(--wt-font-weight-bold);
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
      }
      .basket-cell {
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
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  /** Set before the element connects. */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The stored order in {@link store}, as the server lists its lines; see the basket's own. */
  @property({ attribute: false }) storedLines: StoredLines | null = null;
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
  @property({ attribute: false }) stationQueue: StationQueueGroup[] = [];
  /** Absent when the venue has no default station configured. */
  @property({ attribute: false }) defaultStationId?: string;
  @property() orderFlow: OrderFlow = "prepay";
  @property() stage: "order" | "collect" = "order";
  @property() operatorName = "";
  @property() invoiceLocale = "es-ES";

  @property({ attribute: false }) selectedFilters: MenuFilters = EMPTY_MENU_FILTERS;
  /** A sale or order is being sent: the visible half of the app's guard against a second send. */
  @property({ type: Boolean }) busy = false;
  /** Holds payment: a basket line must be resolved first, or the retrieved order has a payment on it. */
  @property({ type: Boolean }) payHeld = false;
  /** Outstanding amount offered through the bill-payment flow. */
  @property() payRest: string | null = null;
  @property() cardProvider: CardProvider = "none";
  /** See the tender card's `takesCash`. */
  @property({ type: Boolean }) takesCash = true;
  /** See the waiting list's `canMoveStation`. */
  @property({ type: Boolean }) canMoveStation = false;
  @property({ type: Boolean }) canEditKitchenNote = false;
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;
  @property({ attribute: false }) cardRetryDetail?: CollectCardDetail;
  @property({ attribute: false }) cardAttemptsOver = 0;
  @property({ attribute: false }) activeReaders: TillActiveReader[] = [];
  @property() defaultReaderId?: string;
  @property({ attribute: false }) receiptLanguages: string[] = [];
  @property({ type: Boolean }) fullInvoices = false;
  @property() receiptLanguage = "";
  @property({ type: Boolean }) asksGuests = false;
  @property({ attribute: false }) receiptGuests: number | null = null;
  /** The enclosing shell owns the header. */
  @property({ type: Boolean }) embedded = false;
  /** A handheld form factor, whose menu browser shows the menu's handheld display. */
  @property({ type: Boolean }) handheld = false;

  readonly #phone = new MediaQueryController(this, PHONE_WIDTH);

  readonly #browserProducts = memoVisibleProducts();
  readonly #searchProducts = memoVisibleProducts();
  readonly #unfilteredProducts = memoVisibleProducts();
  readonly #unfilteredSearchProducts = memoVisibleProducts();

  #logout(): void {
    this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
  }

  #showSchedule(): void {
    this.dispatchEvent(new CustomEvent("show-schedule", { bubbles: true, composed: true }));
  }

  #showFloor(): void {
    this.dispatchEvent(new CustomEvent("show-floor", { bubbles: true, composed: true }));
  }

  #showStation(): void {
    this.dispatchEvent(new CustomEvent("show-station", { bubbles: true, composed: true }));
  }

  #showExpo(): void {
    this.dispatchEvent(new CustomEvent("show-expo", { bubbles: true, composed: true }));
  }

  #pickFilters(filters: MenuFilters): void {
    this.selectedFilters = filters;
  }

  #menuControls(): TemplateResult {
    return html`
      ${servicePeriod(this.service, this.departmentName, this.api, this.selectedServiceZoneId, this.zoneName)}
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
    if (this.service?.open !== true || !this.service.zoneOpen) return nothing;
    const menu = this.menuSelectionRequired
      ? this.menus.find((menu) => menu.id === this.selectedMenuId && menu.orderable)
      : shownMenu(this.menus, this.selectedMenuId);
    if (menu === undefined) return nothing;
    const served = this.products.filter((product) =>
      this.menus.some((each) => each.id === product.catalogueId && each.orderable),
    );
    return html`<till-menu-browser
      .menu=${menu}
      .products=${this.#browserProducts(this.products, menu.id, this.selectedFilters)}
      .unfilteredProducts=${this.#unfilteredProducts(this.products, menu.id, EMPTY_MENU_FILTERS)}
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
      <wt-button
        variant="primary"
        data-pay-rest
        .disabled=${this.busy}
        @click=${() => this.dispatchEvent(new CustomEvent("counter-bill-pay", { detail: { amount: outstanding }, bubbles: true, composed: true }))}
        >${t("bill.take_rest")}</wt-button
      >
    </section>`;
  }

  #gridBody(): TemplateResult {
    return html`<div class="body grid-body">
      <div class="sale-grid">
        <div class="menu-cell">
          ${
            this.orderList === null
              ? html`<div class="menu-controls">${this.#menuControls()}</div>
                  ${this.#menu()}`
              : this.#lists()
          }
        </div>
        <div class="basket-cell">
          <till-basket
            ?stacked=${this.#phone.matches}
            .store=${this.store}
            .storedLines=${this.storedLines}
            .makeAtStations=${this.makeAtStations}
            .orderInFlight=${this.orderInFlight}
          ></till-basket>
        </div>
        <div class="total-cell"><till-total .store=${this.store}></till-total></div>
        <div class="payment-cell">
          ${this.payRest === null ? nothing : this.#takeRest(this.payRest)}<till-tender-pay
            .store=${this.store}
            .busy=${this.busy || this.payHeld}
            .held=${this.payHeld && !this.busy}
            .mode=${this.orderFlow}
            .stage=${this.stage}
            .cardProvider=${this.cardProvider}
            .takesCash=${this.takesCash}
            .tipsEnabled=${this.tipsEnabled}
            .cardOutcome=${this.cardOutcome}
            .cardRetryDetail=${this.cardRetryDetail}
            .cardAttemptsOver=${this.cardAttemptsOver}
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
    return html`
      <div class="screen">
        ${
          this.embedded
            ? nothing
            : html`<div class="header">
                <span class="brand">${BRAND}</span>
                <div class="session">
                  <wt-button
                    class="equipment"
                    variant="secondary"
                    @click=${() =>
                      this.dispatchEvent(
                        new CustomEvent("open-equipment", { bubbles: true, composed: true }),
                      )}
                  >
                    ${t("equipment.open")}
                  </wt-button>
                  <wt-button class="floor" variant="secondary" @click=${() => this.#showFloor()}>
                    ${t("floor.open")}
                  </wt-button>
                  <wt-button
                    class="station"
                    variant="secondary"
                    @click=${() => this.#showStation()}
                  >
                    ${t("station.open")}
                  </wt-button>
                  <wt-button class="expo" variant="secondary" @click=${() => this.#showExpo()}>
                    ${t("expo.open")}
                  </wt-button>
                  <wt-button
                    class="schedule"
                    variant="secondary"
                    @click=${() => this.#showSchedule()}
                  >
                    ${t("schedule.open")}
                  </wt-button>
                  <wt-language-chooser
                    active=${currentLocale()}
                    .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
                  ></wt-language-chooser>
                  <span class="operator">${this.operatorName}</span>
                  <wt-button class="logout" variant="secondary" @click=${() => this.#logout()}>
                    ${t("action.logout")}
                  </wt-button>
                </div>
              </div>`
        }
        ${this.#gridBody()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-screen": TillCounterScreen;
  }
}
