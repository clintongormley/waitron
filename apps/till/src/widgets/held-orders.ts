import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import type { HeldOrderSummary } from "../api/client.js";

/**
 * Lists every open order in the venue, so an order parked on one register is retrieved on another.
 * A pure view: the app owns the list and turns the `retrieve-order` and `discard-order` events into API
 * calls.
 */
@customElement("till-held-orders")
export class TillHeldOrders extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .title {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .order {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .label {
        color: var(--wt-color-text);
      }

      .meta {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) orders: HeldOrderSummary[] = [];

  #retrieve(id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>("retrieve-order", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #discard(id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>("discard-order", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <h2 class="title">${t("held.title")}</h2>
      ${
        this.orders.length === 0
          ? html`<p class="empty">${t("held.empty")}</p>`
          : this.orders.map(
              (order) => html`
                <div class="order">
                  <div class="summary">
                    <span class="number">#${order.orderNumber}</span>
                    ${order.label ? html`<span class="label">${order.label}</span>` : nothing}
                    <span class="meta"
                      >${order.itemCount} · ${formatMoney(order.total, currentLocale())}</span
                    >
                  </div>
                  <wt-button
                    class="retrieve"
                    variant="primary"
                    aria-label=${`${t("held.retrieve")} #${order.orderNumber}${
                      order.label ? ` ${order.label}` : ""
                    }`}
                    @click=${() => this.#retrieve(order.id)}
                  >
                    ${t("held.retrieve")}
                  </wt-button>
                  <wt-button
                    class="discard"
                    variant="danger"
                    aria-label=${`${t("held.discard")} #${order.orderNumber}${
                      order.label ? ` ${order.label}` : ""
                    }`}
                    @click=${() => this.#discard(order.id)}
                  >
                    ${t("held.discard")}
                  </wt-button>
                </div>
              `,
            )
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-held-orders": TillHeldOrders;
  }
}
