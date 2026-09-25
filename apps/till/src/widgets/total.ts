import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { WorkingOrderStore } from "../state/working-order.js";

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

  /** Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  constructor() {
    super();
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
