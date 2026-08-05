import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { LAYOUT_A, type LayoutDef, type WidgetInstance } from "../layout.js";
// Side-effect imports: registering each widget element so the layout below can render its tag. The
// screen names them only as tags in `#widget`, never as classes, so the layout stays the wiring.
import "../widgets/product-grid.js";
import "../widgets/basket.js";
import "../widgets/total.js";
import "../widgets/tender-pay.js";
import type { TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";

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
  /** The logged-in operator's display name, shown in the header. Data, never translated. */
  @property() operatorName = "";
  /**
   * A sale is in flight (the app is awaiting `recordSale`). Threaded straight through to the pay
   * widget, which disables its Pay/Confirm affordances while set — the visible half of the app's
   * single-flight double-file guard (see `till-app`'s `submitting`).
   */
  @property({ type: Boolean }) busy = false;
  /** The arrangement to render. Defaults to slice 1's {@link LAYOUT_A}; a later editor supplies its own. */
  @property({ attribute: false }) layout: LayoutDef = LAYOUT_A;

  /** Announce that the operator wants to end their shift. The app (Task 19) tears the session down. */
  #logout(): void {
    this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
  }

  /**
   * Map one layout entry to its element, handing over the shared store (and, for the grid, the
   * products). The switch is exhaustive over {@link WidgetType}, so adding a widget type without a
   * case here is a compile error rather than a silently-dropped widget.
   */
  #widget(instance: WidgetInstance): TemplateResult {
    switch (instance.type) {
      case "product-grid":
        return html`<till-product-grid
          .products=${this.products}
          .store=${this.store}
        ></till-product-grid>`;
      case "basket":
        return html`<till-basket .store=${this.store}></till-basket>`;
      case "total":
        return html`<till-total .store=${this.store}></till-total>`;
      case "tender-pay":
        return html`<till-tender-pay .store=${this.store} .busy=${this.busy}></till-tender-pay>`;
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
            <span class="operator">${this.operatorName}</span>
            <wt-button class="logout" variant="secondary" @click=${() => this.#logout()}>
              ${t("action.logout")}
            </wt-button>
          </div>
        </div>
        <div class="body">
          <div class="region region-main">
            ${inRegion("main").map((widget) => this.#widget(widget))}
          </div>
          <div class="region region-aside">
            ${inRegion("aside").map((widget) => this.#widget(widget))}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-screen": TillCounterScreen;
  }
}
