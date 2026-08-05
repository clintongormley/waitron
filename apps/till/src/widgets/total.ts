import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { WorkingOrderStore } from "../state/working-order.js";

/**
 * The grand-total readout. Shows the "Total" label and the store's previewed total (the SERVER's
 * `priceBasket` total, VAT-inclusive), re-rendering on every `"changed"` event. It computes nothing
 * itself — reading `store.total` is what guarantees the number on screen equals the one the server
 * re-prices and files at pay time.
 */
@customElement("till-total")
export class TillTotal extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3) var(--wt-space-4);
      }

      .label {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .amount {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  /** The order whose total is shown. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  constructor() {
    super();
    // Re-render on any basket change; the controller owns the subscription lifecycle.
    new StoreChangeController(this, () => this.store);
  }

  override render() {
    return html`
      <span class="label">${t("label.total")}</span>
      <span class="amount">${formatMoney(this.store.total)}</span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-total": TillTotal;
  }
}
