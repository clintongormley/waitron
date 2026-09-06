import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import { type DietPredicate, hasDietData, visibleProducts } from "../menu-filter.js";
import type { TabDef } from "../layout.js";
// The SP-B card grid — the screen delegates its whole sale body to this element, which lays the
// counter tab's cards on a fluid grid. It self-registers every card it can place (product-grid/basket/
// total/tender-pay/held-orders/station-queue), so the screen names it only as a tag, never as a class.
import "../widgets/card-grid.js";
// The multi-menu switcher shown above the grid — renders nothing for a single-menu location.
import "../widgets/menu-switcher.js";
// The menu DIET filter shown above the grid (dietary-classification, Task 7) — narrows the tiles to a
// dietary lens via `filterProductsByDiet`. Rendered only when some product carries a published diet.
import "../widgets/diet-filter.js";
// The allergen screen the "Allergens" header button reveals (menu & allergens) — a full-body view, not
// a card, so it is registered here and toggled in `render`, replacing the grid body when open.
import "./till-allergen-screen.js";
// The post-login language chooser (per-user-language-preference). It only EMITS a
// composed `locale-selected`; `till-app` persists the pick and switches the locale.
import "../widgets/language-chooser.js";
import type {
  HeldOrderSummary,
  OrderFlow,
  StationQueueGroup,
  TillApi,
  TillMenu,
  TillProduct,
} from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { CardOutcome, CardProvider } from "../widgets/tender-pay.js";

/**
 * The till's product WORDMARK — the venue/till label slot in the header. Slice 1 has no venue prop
 * (unlike the fiscal ticket, which is handed one), so this stands in for the venue/till identity a
 * later slice will wire to real data. A brand wordmark is a fixed name, not translated UI copy —
 * the same reason the ticket's `VERI*FACTU` legend is a constant and not a `t()` key.
 */
const BRAND = "Waitron";

/**
 * The Counter POS shell: the header the operator sees and the sale body. It owns exactly two things —
 * the header (venue/till label, the logged-in operator, a Log out control) plus the menu/diet chrome —
 * and nothing about the sale itself.
 *
 * The sale body is DATA-DRIVEN through the device canvas: {@link render} hands the {@link counterTab}
 * to {@link TillCardGrid}, which lays the tab's cards on a fluid grid. The screen hardcodes no card
 * tags in its own markup — a different tab (an editor's output) rearranges or drops cards without the
 * screen changing (the configurable-canvas seam, SP-B). The old region/widget model is gone.
 *
 * The cards do NOT talk to the screen or to each other: every one is handed the SAME {@link store}
 * (and the product grid the {@link products}) by the grid, and they coordinate through it. The screen
 * never handles `confirm-payment` or a product tap — `confirm-payment` is composed and bubbles past
 * here to the app (Task 19); the only event this screen owns is `logout`.
 */
@customElement("till-counter-screen")
export class TillCounterScreen extends LitElement {
  static override styles = [
    baseStyles,
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
    `,
  ];

  /** The HTTP face of the till, threaded from the app. The language chooser reads it
   * (`getLocales`) to offer the venue's languages; the app owns persisting a pick. */
  @property({ attribute: false }) api!: TillApi;
  /** The shared working order every widget reads and mutates. Set before the element connects. */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** ALL sellable products across the location's accessible menus. The product grid shows only the
   * SELECTED menu's (via {@link filterProductsByMenu}); the allergen lookup screen keeps the full set. */
  @property({ attribute: false }) products: TillProduct[] = [];
  /** The location's accessible menus, handed to the menu switcher above the grid. With one menu (or none)
   * the switcher renders nothing, so a single-menu location looks exactly as before. */
  @property({ attribute: false }) menus: TillMenu[] = [];
  /** The menu (catalogue) the grid currently shows — narrows the grid via {@link filterProductsByMenu}
   * and marks the active switcher option. Owned by the app; a switcher pick bubbles up as `menu-selected`
   * for it to update. */
  @property() selectedMenuId = "";
  /** The node's open parked orders, handed to the held-orders list (the app owns and refreshes them). */
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  /**
   * The DEFAULT station's queue (KDS-1, design §3e — "the counter prep-queue becomes the default
   * station"), grouped by order, threaded to the card grid for its `prep-queue` card to render (the app
   * owns and refreshes them). Defaults empty so a tab that carries a `prep-queue` card renders its empty
   * state until the app wires a live refresh.
   */
  @property({ attribute: false }) stationQueue: StationQueueGroup[] = [];
  /**
   * The DEFAULT station's id (KDS-1), threaded through the card grid to the station-queue card — its
   * whole-ticket bump is keyed by station. Absent when the venue has no default station configured. The
   * counter's own queue is
   * per-line (line mode), so this is passed for correctness rather than exercised here.
   */
  @property({ attribute: false }) defaultStationId?: string;
  /**
   * The location's pay-timing mode (7c prepare & collect), threaded straight through to the pay
   * widget's own `mode` — see `till-tender-pay`'s PER-MODE CONTROL doc for exactly which idle control
   * each `orderFlow`/`stage` combination renders. Defaults `"prepay"`, reproducing 7a/7b's walk-up
   * flow unchanged.
   */
  @property() orderFlow: OrderFlow = "prepay";
  /** Where the current basket sits in a Mode-I/T order's life — threaded straight through to the pay
   * widget's own `stage`. Ignored under Mode P. */
  @property() stage: "order" | "collect" = "order";
  /** The logged-in operator's display name, shown in the header. Data, never translated. */
  @property() operatorName = "";
  /**
   * The INVOICE (customer) locale, threaded straight through to the allergen screen's own
   * `invoiceLocale` — the language its Print re-renders in, independent of the operator UI (see
   * `till-allergen-screen`'s LOCALE doc). Fed from the server till config by the app (`GET /api/till`),
   * the same source `till-ticket-view` reads. Defaults to the deli's es-ES.
   */
  @property() invoiceLocale = "es-ES";

  /** Whether the allergen lookup screen is showing in place of the sale body (menu & allergens). The
   * "Allergens" header button opens it; the screen's own Close (`close-allergens`) returns to the sale. */
  @state() private showAllergens = false;
  /** The session's dietary selection; null shows every dish in the selected menu. */
  @property({ attribute: false }) selectedDiet: DietPredicate | null = null;
  /**
   * A sale is in flight (the app is awaiting `recordSale`). Threaded straight through to the pay
   * widget, which disables its Pay/Confirm affordances while set — the visible half of the app's
   * single-flight double-file guard (see `till-app`'s `submitting`).
   */
  @property({ type: Boolean }) busy = false;
  /**
   * The device canvas's COUNTER tab (SP-B). The screen delegates its whole sale body to
   * {@link TillCardGrid}, which lays this tab's cards on a fluid grid. Threaded by the app from the
   * boot canvas ({@link TillApp.#tabBody}); a successful boot always resolves a canvas, so this is
   * always supplied off-lock. When undefined the grid renders nothing (the region model it replaced
   * is gone — SP-B4).
   */
  @property({ attribute: false }) counterTab?: TabDef;
  /**
   * The till's integrated-card wiring (Task 9), threaded straight through to the pay widget's own
   * `cardProvider` — see `till-tender-pay`'s INTEGRATED CARD doc for what each value does. Defaults
   * `"none"`, reproducing the #62 manual (datáfono) Card path unchanged.
   */
  @property() cardProvider: CardProvider = "none";
  /** Whether the till prompts for a tip on an integrated-card collection (Task 9), threaded straight
   * through to the pay widget's own `tipsEnabled`. Ignored under the manual path. */
  @property({ type: Boolean }) tipsEnabled = false;
  /** The outcome of the most recent non-captured `collect-card` attempt (Task 8/9), threaded
   * straight through to the pay widget's own `cardOutcome` — see its doc for how a fresh value drives
   * the retry / switch-tender / wait screen. */
  @property() cardOutcome?: CardOutcome;
  /**
   * Whether this screen is rendered INSIDE the canvas tab shell (SP-B2.1). When set, the screen
   * suppresses its own `.header` — the brand/operator/log-out/affordance chrome lives in the shell
   * (`till-tab-shell`), so a duplicate header would double it. The sale body (menu controls + the
   * card grid) is unchanged; only the header relocates. Defaults false, but since SP-B4 the app always
   * mounts the counter screen embedded inside the shell (a canvas is always present — `till-app.ts`
   * `#tabBody`), so the non-embedded own-header branch is now exercised only by this screen's own tests.
   */
  @property({ type: Boolean }) embedded = false;

  /** Announce that the operator wants to end their shift. The app (Task 19) tears the session down. */
  #logout(): void {
    this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
  }

  /** Announce that the operator wants their staff schedule. The app switches to the schedule screen
   * WITHOUT clearing the basket (like logout — the basket is till-owned). */
  #showSchedule(): void {
    this.dispatchEvent(new CustomEvent("show-schedule", { bubbles: true, composed: true }));
  }

  /** Announce that the operator wants the live floor (FP-1). The app switches to the floor screen
   * (loading zones + occupancy) WITHOUT clearing the basket — mirrors {@link #showSchedule}. */
  #showFloor(): void {
    this.dispatchEvent(new CustomEvent("show-floor", { bubbles: true, composed: true }));
  }

  /** Announce that the operator (or kitchen staff) wants the station-display screen (KDS-1). The app
   * switches to it WITHOUT clearing the basket — mirrors {@link #showFloor}. */
  #showStation(): void {
    this.dispatchEvent(new CustomEvent("show-station", { bubbles: true, composed: true }));
  }

  /** Announce that the operator (or pass/expo staff) wants the expo/pass display screen (KDS-3). The
   * app switches to it WITHOUT clearing the basket — mirrors {@link #showStation}. */
  #showExpo(): void {
    this.dispatchEvent(new CustomEvent("show-expo", { bubbles: true, composed: true }));
  }

  /** Apply the diet-filter widget's pick (`diet-filter-selected`) — a predicate or `null` (cleared). */
  #pickDiet(predicate: DietPredicate | null): void {
    this.selectedDiet = predicate;
  }

  /** The tiles the grid shows: the selected menu's products ({@link filterProductsByMenu}), then narrowed
   *  to the active diet lens ({@link filterProductsByDiet}) when one is set. The allergen lookup screen
   *  keeps the FULL set (a tab may span menus, and allergen lookup must reach every product). */
  #gridProducts(): TillProduct[] {
    return visibleProducts(this.products, this.selectedMenuId, this.selectedDiet);
  }

  /** Whether to show the diet filter at all — only when some product carries a published diet, so a
   *  venue with no dietary data adds no filter chrome above the grid. */
  #hasDietData(): boolean {
    return hasDietData(this.products);
  }

  /** Reveal the allergen lookup screen in place of the sale body. */
  #openAllergens(): void {
    this.showAllergens = true;
  }

  /** Return to the sale body when the allergen screen asks to close (`close-allergens`). */
  #closeAllergens(): void {
    this.showAllergens = false;
  }

  /**
   * The menu switcher + diet filter shown above the card grid. The diet filter is shown only when some
   * product carries a published diet ({@link #hasDietData}).
   */
  #menuControls(): TemplateResult {
    return html`
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

  /**
   * The sale body (SP-B): the menu/diet chrome above, then the counter tab's cards laid out by
   * {@link TillCardGrid}. The grid is fed `#gridProducts()` (menu + diet narrowed), never the raw
   * `products`, so `till-card-grid` stays dumb and the menu/diet filtering lives here. The tab is
   * {@link counterTab}; a boot always resolves one, so it is present off-lock (an undefined tab leaves
   * the grid rendering nothing).
   */
  #gridBody(): TemplateResult {
    return html`<div class="body grid-body">
      ${this.#menuControls()}
      <till-card-grid
        .tab=${this.counterTab}
        .store=${this.store}
        .products=${this.#gridProducts()}
        .selectedDiet=${this.selectedDiet}
        .heldOrders=${this.heldOrders}
        .stationQueue=${this.stationQueue}
        .defaultStationId=${this.defaultStationId}
        .busy=${this.busy}
        .orderFlow=${this.orderFlow}
        .stage=${this.stage}
        .cardProvider=${this.cardProvider}
        .tipsEnabled=${this.tipsEnabled}
        .cardOutcome=${this.cardOutcome}
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
                  <span class="operator">${this.operatorName}</span>
                  <till-language-chooser
                    .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
                  ></till-language-chooser>
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
