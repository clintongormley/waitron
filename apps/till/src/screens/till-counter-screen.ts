import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import { LAYOUT_A, type LayoutDef, type WidgetInstance } from "../layout.js";
// Side-effect imports: registering each widget element so the layout below can render its tag. The
// screen names them only as tags in `#widget`, never as classes, so the layout stays the wiring.
import "../widgets/product-grid.js";
import "../widgets/basket.js";
import "../widgets/total.js";
import "../widgets/tender-pay.js";
import "../widgets/held-orders.js";
import "../widgets/prep-queue.js";
// The allergen screen the "Allergens" header button reveals (menu & allergens) — a full-body view, not
// a layout widget, so it is registered here and toggled in `render`, never placed through `#widget`.
import "./till-allergen-screen.js";
import type { HeldOrderSummary, OrderFlow, PrepQueueEntry, TillProduct } from "../api/client.js";
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
 * The Counter POS shell: the header the operator sees and the LAYOUT COMPOSITION of the four sale
 * widgets. It owns exactly two things — the header (venue/till label, the logged-in operator, a Log
 * out control) and the arrangement — and nothing about the sale itself.
 *
 * The arrangement is DATA: {@link render} iterates {@link layout} and maps each {@link WidgetInstance}'s
 * `type` to its element (`#widget`), dropping it into the `main` or `aside` region. It hardcodes no
 * widget tags in the markup, so a different `LayoutDef` (a later slice's editor output) rearranges or
 * drops widgets without the screen changing — the configurable-dashboard seam (spec §3).
 *
 * The widgets do NOT talk to the screen or to each other: every one is handed the SAME {@link store}
 * (and the product grid the {@link products}), and they coordinate through it. The screen never
 * handles `confirm-payment` or a product tap — `confirm-payment` is composed and bubbles past here to
 * the app (Task 19); the only event this screen owns is `logout`.
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

      .body {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: var(--wt-space-4);
        align-items: start;
        padding: var(--wt-space-4);
      }

      .region-aside {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      /* Narrow screens (a phone or a split view) stack the aside UNDER the grid, one column. */
      @media (max-width: 48rem) {
        .body {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  /** The shared working order every widget reads and mutates. Set before the element connects. */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /** The sellable products, handed to the product grid (the only widget that needs them). */
  @property({ attribute: false }) products: TillProduct[] = [];
  /** The node's open parked orders, handed to the held-orders list (the app owns and refreshes them). */
  @property({ attribute: false }) heldOrders: HeldOrderSummary[] = [];
  /**
   * This node's active prep-queue entries (7c prepare & collect), handed to the prep-queue widget
   * (the app owns and refreshes them — see `till-prep-queue`'s own doc). Defaults empty so a layout
   * that includes `prep-queue` renders its empty state until the app wires a live refresh.
   */
  @property({ attribute: false }) prepQueue: PrepQueueEntry[] = [];
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
  /**
   * A sale is in flight (the app is awaiting `recordSale`). Threaded straight through to the pay
   * widget, which disables its Pay/Confirm affordances while set — the visible half of the app's
   * single-flight double-file guard (see `till-app`'s `submitting`).
   */
  @property({ type: Boolean }) busy = false;
  /** The arrangement to render. Defaults to slice 1's {@link LAYOUT_A}; a later editor supplies its own. */
  @property({ attribute: false }) layout: LayoutDef = LAYOUT_A;
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

  /** Announce that the operator wants to end their shift. The app (Task 19) tears the session down. */
  #logout(): void {
    this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
  }

  /** Announce that the operator wants their staff schedule. The app switches to the schedule screen
   * WITHOUT clearing the basket (like logout — the basket is till-owned). */
  #showSchedule(): void {
    this.dispatchEvent(new CustomEvent("show-schedule", { bubbles: true, composed: true }));
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
   * Map one layout entry to its element, handing over the shared store (and, for the grid, the
   * products). The switch is exhaustive over {@link WidgetType}, so adding a widget type without a
   * case here is a compile error rather than a silently-dropped widget.
   */
  #widget(instance: WidgetInstance): TemplateResult {
    switch (instance.type) {
      case "product-grid": {
        // Thread the one wired per-widget config key, `product-grid.columns`. The config bag is
        // `Record<string, unknown>`, so narrow to a number and pass it through only then — a
        // missing/malformed value leaves the widget's responsive auto-fill default (its own `columns`
        // doc). The value is validated 1..12 server-side (`@waitron/layouts` `WIDGET_CONFIG`).
        const columns = instance.config.columns;
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
        return html`<till-prep-queue .entries=${this.prepQueue}></till-prep-queue>`;
    }
  }

  override render() {
    const inRegion = (region: WidgetInstance["region"]) =>
      this.layout.filter((widget) => widget.region === region);
    return html`
      <div class="screen">
        <div class="header">
          <span class="brand">${BRAND}</span>
          <div class="session">
            <wt-button class="allergens" variant="secondary" @click=${() => this.#openAllergens()}>
              ${t("allergens.open")}
            </wt-button>
            <wt-button class="schedule" variant="secondary" @click=${() => this.#showSchedule()}>
              ${t("schedule.open")}
            </wt-button>
            <span class="operator">${this.operatorName}</span>
            <wt-button class="logout" variant="secondary" @click=${() => this.#logout()}>
              ${t("action.logout")}
            </wt-button>
          </div>
        </div>
        ${
          this.showAllergens
            ? html`<till-allergen-screen
                class="allergen-screen"
                .products=${this.products}
                .locale=${currentLocale()}
                .invoiceLocale=${this.invoiceLocale}
                @close-allergens=${() => this.#closeAllergens()}
              ></till-allergen-screen>`
            : html`<div class="body">
                <div class="region region-main">
                  ${inRegion("main").map((widget) => this.#widget(widget))}
                </div>
                <div class="region region-aside">
                  ${inRegion("aside").map((widget) => this.#widget(widget))}
                </div>
              </div>`
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
