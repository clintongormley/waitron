import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import type { HeldOrderSummary } from "../api/client.js";

/**
 * The cross-till HELD-ORDERS list (park & retrieve, sub-project 7b): one row per parked order the
 * node holds — its human order number, the operator's optional label, the line count and the running
 * total — each with a Retrieve control (load it back into the basket) and a Discard control (abandon
 * it). Because the list is the whole node's OPEN orders, an order parked on one register is retrieved
 * on another; that is the cross-till story this widget completes.
 *
 * It is a PURE VIEW: it holds no state and never talks to the store or the API. The app owns the
 * list (`till-app.heldOrders`, refreshed on entering the counter and after every park/retrieve/discard)
 * and hands it down; the two controls emit composed, bubbling `retrieve-order`/`discard-order` events
 * carrying only the order `id`, which the app turns into a `retrieveWorkingOrder`/`abandonWorkingOrder`
 * call. The widget names no sibling and reaches for no store (spec §3).
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

  /** The node's open parked orders to list. The app owns and refreshes this; the widget only renders it. */
  @property({ attribute: false }) orders: HeldOrderSummary[] = [];

  /** Ask the app to load parked order `id` back into the basket. */
  #retrieve(id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>("retrieve-order", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Ask the app to abandon parked order `id`. */
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
                    <span class="meta">${order.itemCount} · ${formatMoney(order.total)}</span>
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
