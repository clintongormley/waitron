import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { type WtCombobox, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { type DietPredicate, hasDietData } from "../menu-filter.js";
import type { TabDef } from "../layout.js";
import { languageChooserStyles } from "../widgets/language-chooser-styles.js";
import "../widgets/card-grid.js";
import "../widgets/menu-switcher.js";
import "../widgets/diet-filter.js";
import "./till-allergen-screen.js";
import type {
  CounterWaitingOrder,
  HeldOrderSummary,
  OrderFlow,
  ServiceZoneSummary,
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

/**
 * The Counter POS shell. Its sale body is DATA-DRIVEN: the {@link counterTab}'s cards are laid out by
 * `till-card-grid`, and the screen hardcodes no card tags, so a different tab rearranges or drops cards
 * without the screen changing. The cards coordinate through the shared {@link store}, not through this
 * screen.
 */
@customElement("till-counter-screen")
export class TillCounterScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    languageChooserStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        flex-direction: column;
        min-height: 100%;
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

      /* The sale body stacks the menu/diet chrome above the card grid, which owns its own internal
         grid. */
      .body.grid-body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        padding: var(--wt-space-4);
      }

      .service-zone {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  /** Set before the element connects. */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The stored order in {@link store}, as the server lists its lines; see the basket's own. */
  @property({ attribute: false }) storedLines: StoredLines | null = null;
  /** A pay, place or hold of {@link store}'s order is out; see the basket's own. */
  @property({ type: Boolean }) orderInFlight = false;
  /** The grid shows the selected menu's offers; the allergen lookup screen keeps the full zone set. */
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) menus: TillZoneMenu[] = [];
  /** Owned by the app; a switcher pick bubbles up as `menu-selected` for it to update. */
  @property() selectedMenuId = "";
  @property({ attribute: false }) serviceZones: ServiceZoneSummary[] = [];
  @property() selectedServiceZoneId = "";
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  @property({ attribute: false }) counterWaiting: CounterWaitingOrder[] = [];
  /** The floor, which a held order's Move to table lists. */
  @property({ attribute: false }) tables: TableState[] = [];
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
  /** A sale is in flight: the visible half of the app's single-flight double-file guard. */
  @property({ type: Boolean }) busy = false;
  /** Holds payment: a basket line must be resolved first, or the retrieved order has a payment on it. */
  @property({ type: Boolean }) payHeld = false;
  /** See the card grid's `payRest`. */
  @property() payRest: string | null = null;
  /** When undefined the grid renders nothing. */
  @property({ attribute: false }) counterTab?: TabDef;
  @property() cardProvider: CardProvider = "none";
  @property({ type: Boolean }) tipsEnabled = false;
  @property() cardOutcome?: CardOutcome;
  @property({ attribute: false }) cardAttemptsOver = 0;
  @property({ attribute: false }) activeReaders: TillActiveReader[] = [];
  @property() defaultReaderId?: string;
  /**
   * Set when rendered INSIDE the canvas tab shell, which owns the header chrome, so the screen drops its
   * own. The app always mounts it embedded (`till-app.ts` `#tabBody`), so the own-header branch is
   * exercised only by this screen's tests.
   */
  @property({ type: Boolean }) embedded = false;
  /** A handheld form factor, whose menu browser shows fewer columns. */
  @property({ type: Boolean }) handheld = false;

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
      <till-menu-switcher
        class="menu-switcher"
        .menus=${this.menus}
        .selectedId=${this.selectedMenuId}
      ></till-menu-switcher>
      ${
        this.#hasDietData()
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

  /** The card grid narrows the products to the shown menu and diet lens itself; the allergen screen
   * keeps the FULL set, because allergen lookup must reach every product. */
  #gridBody(): TemplateResult {
    return html`<div class="body grid-body">
      ${this.#menuControls()}
      <till-card-grid
        .tab=${this.counterTab}
        .store=${this.store}
        .storedLines=${this.storedLines}
        .orderInFlight=${this.orderInFlight}
        .products=${this.products}
        .menus=${this.menus}
        .selectedMenuId=${this.selectedMenuId}
        .selectedDiet=${this.selectedDiet}
        .handheld=${this.handheld}
        .heldOrders=${this.heldOrders}
        .counterWaiting=${this.counterWaiting}
        .tables=${this.tables}
        .stationQueue=${this.stationQueue}
        .defaultStationId=${this.defaultStationId}
        .busy=${this.busy}
        .payHeld=${this.payHeld}
        .payRest=${this.payRest}
        .orderFlow=${this.orderFlow}
        .stage=${this.stage}
        .cardProvider=${this.cardProvider}
        .tipsEnabled=${this.tipsEnabled}
        .cardOutcome=${this.cardOutcome}
        .cardAttemptsOver=${this.cardAttemptsOver}
        .activeReaders=${this.activeReaders}
        .defaultReaderId=${this.defaultReaderId}
      ></till-card-grid>
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
