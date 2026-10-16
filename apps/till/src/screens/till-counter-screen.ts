import { servicePeriod, servicePeriodStyles } from "../widgets/service-period.js";
import type { MenuState } from "../api/client.js";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { type WtCombobox, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { type DietPredicate, hasDietData, memoVisibleProducts, shownMenu } from "../menu-filter.js";
import { formatMoney } from "@waitron/shared";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { languageChooserStyles } from "../widgets/language-chooser-styles.js";
import "../widgets/menu-browser.js";
import "../widgets/basket.js";
import "../widgets/total.js";
import "../widgets/tender-pay.js";
import "../widgets/held-orders.js";
import "../widgets/counter-waiting.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import "./till-allergen-screen.js";
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
import type { CardOutcome, CardProvider } from "../widgets/tender-pay.js";

/** A brand wordmark is a fixed name, not translated UI copy. */
const BRAND = "Waitron";

@customElement("till-counter-screen")
export class TillCounterScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
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

      .menu-controls till-menu-switcher::part(options),
      .menu-controls till-diet-filter::part(options) {
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

      .service-zone {
        max-width: 100%;
        flex-wrap: wrap;
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .service-zone wt-combobox {
        min-width: min(100%, calc(var(--wt-tap-min) * 4));
        max-width: 100%;
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
  /** The grid shows the selected menu's offers; the allergen lookup screen keeps the full zone set. */
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) menus: TillZoneMenu[] = [];
  @property({ attribute: false }) service: MenuState["service"] | null = {
    open: true,
    zoneOpen: true,
    periodName: null,
    zoneKeepOpen: null,
    keepOpen: null,
  };
  @property() departmentName = "";
  @property() zoneName = "";
  /** Owned by the app; a switcher pick bubbles up as `menu-selected` for it to update. */
  @property() selectedMenuId = "";
  @property({ attribute: false }) serviceZones: ServiceZoneSummary[] = [];
  @property() selectedServiceZoneId = "";
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

  @state() private showAllergens = false;
  /** null shows every dish in the selected menu. */
  @property({ attribute: false }) selectedDiet: DietPredicate | null = null;
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
  @property({ attribute: false }) cardAttemptsOver = 0;
  @property({ attribute: false }) activeReaders: TillActiveReader[] = [];
  @property() defaultReaderId?: string;
  @property({ attribute: false }) receiptLanguages: string[] = [];
  @property({ type: Boolean }) fullInvoices = false;
  @property() receiptLanguage = "";
  /** The enclosing shell owns the header. */
  @property({ type: Boolean }) embedded = false;
  /** A handheld form factor, whose menu browser shows the menu's handheld display. */
  @property({ type: Boolean }) handheld = false;

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

  #pickDiet(predicate: DietPredicate | null): void {
    this.selectedDiet = predicate;
  }

  #pickServiceZone(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const requestedZoneId = event.detail.value;
    if (this.store.lines.length > 0) {
      (event.currentTarget as WtCombobox).value = this.selectedServiceZoneId;
    }
    this.dispatchEvent(
      new CustomEvent<{ zoneId: string }>("counter-zone-selected", {
        detail: { zoneId: requestedZoneId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #refreshServiceZone(): void {
    if (this.selectedServiceZoneId === "" || this.store.lines.length > 0) return;
    this.dispatchEvent(
      new CustomEvent<{ zoneId: string }>("counter-zone-selected", {
        detail: { zoneId: this.selectedServiceZoneId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #hasDietData(): boolean {
    return hasDietData(this.products);
  }

  #openAllergens(): void {
    this.showAllergens = true;
  }

  #closeAllergens(): void {
    this.showAllergens = false;
  }

  #menuControls(): TemplateResult {
    return html`
      ${
        this.serviceZones.length > 0
          ? html`<div class="service-zone">
              <wt-combobox
                name="service-zone"
                label=${t("service_zone.label")}
                search="auto"
                searchPlaceholder=${t("form.combobox_search")}
                noResultsLabel=${t("form.combobox_no_results")}
                .options=${this.serviceZones.map((zone) => ({ value: zone.id, label: zone.name }))}
                .value=${live(this.selectedServiceZoneId)}
                @wt-change=${this.#pickServiceZone}
              ></wt-combobox>
              <wt-button
                class="service-zone-refresh"
                variant="secondary"
                ?disabled=${this.store.lines.length > 0}
                @click=${this.#refreshServiceZone}
              >
                ${t("service_zone.refresh")}
              </wt-button>
            </div>`
          : nothing
      }
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
      ${
        this.service?.open === true && this.service.zoneOpen && this.#hasDietData()
          ? html`<till-diet-filter
              class="diet-filter"
              .selected=${this.selectedDiet}
              @diet-filter-selected=${(e: CustomEvent<{ predicate: DietPredicate | null }>) =>
                this.#pickDiet(e.detail.predicate)}
            ></till-diet-filter>`
          : nothing
      }
    `;
  }

  #menu(): TemplateResult | typeof nothing {
    if (this.service?.open !== true || !this.service.zoneOpen) return nothing;
    const menu = shownMenu(this.menus, this.selectedMenuId);
    if (menu === undefined) return nothing;
    const served = this.products.filter((product) =>
      this.menus.some((each) => each.id === product.catalogueId && each.orderable),
    );
    return html`<till-menu-browser
      .menu=${menu}
      .products=${this.#browserProducts(this.products, menu.id, this.selectedDiet)}
      .unfilteredProducts=${this.#unfilteredProducts(this.products, menu.id, null)}
      .menus=${this.menus}
      .servedProducts=${this.#searchProducts(served, "", this.selectedDiet)}
      .unfilteredServedProducts=${this.#unfilteredSearchProducts(served, "", null)}
      .store=${this.store}
      .handheld=${this.handheld}
    ></till-menu-browser>`;
  }

  #lists(): TemplateResult | typeof nothing {
    if (this.heldOrders.length === 0 && this.counterWaiting.length === 0) return nothing;
    return html`<till-held-orders
        .orders=${this.heldOrders}
        .tables=${this.tables}
        .zones=${this.zones}
      ></till-held-orders>
      <till-counter-waiting
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
          <div class="menu-controls">${this.#menuControls()}</div>
          ${this.#menu()}${this.phone ? nothing : this.#lists()}
        </div>
        <div class="basket-cell">
          <till-basket
            ?stacked=${this.phone}
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
            .cardAttemptsOver=${this.cardAttemptsOver}
            .activeReaders=${this.activeReaders}
            .defaultReaderId=${this.defaultReaderId}
            .receiptLanguages=${this.receiptLanguages}
            .fullInvoices=${this.fullInvoices}
            .receiptLanguage=${this.receiptLanguage}
          ></till-tender-pay>
        </div>
        ${this.phone ? this.#lists() : nothing}
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
                  <wt-button
                    class="allergens"
                    variant="secondary"
                    @click=${() => this.#openAllergens()}
                  >
                    ${t("allergens.open")}
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
        ${
          this.showAllergens
            ? html`<till-allergen-screen
                class="allergen-screen"
                .products=${this.products}
                .locale=${currentLocale()}
                .invoiceLocale=${this.invoiceLocale}
                @close-allergens=${() => this.#closeAllergens()}
              ></till-allergen-screen>`
            : this.#gridBody()
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-screen": TillCounterScreen;
  }
}
