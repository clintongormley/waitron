import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { CounterWaitingOrder } from "../api/client.js";

/**
 * The counter orders still waiting on the counter: sent and not paid, or paid and not handed over
 * (spec §5, "Counter service"). A pure view that renders nothing when no order waits; the app turns
 * its `hand-over-order` and `pay-waiting-order` events into API calls.
 */
@customElement("till-counter-waiting")
export class TillCounterWaiting extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .title {
        margin: var(--wt-space-3) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .order {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .summary {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .controls {
        display: flex;
        flex: 0 1 auto;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        margin-inline-start: auto;
      }

      .number,
      .state {
        font-weight: var(--wt-font-weight-bold);
      }

      .meta {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) orders: CounterWaitingOrder[] = [];
  /** This till can take a sent order's payment: it has a collect stage to open. */
  @property({ type: Boolean }) canPay = false;

  #emit(type: string, order: CounterWaitingOrder): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { id: order.id }, bubbles: true, composed: true }),
    );
  }

  #state(order: CounterWaitingOrder): StringKey {
    if (order.status === "settled") return "waiting.paid_not_handed_over";
    return order.collectedAt === null ? "waiting.sent_not_paid" : "waiting.handed_over_not_paid";
  }

  #row(order: CounterWaitingOrder): TemplateResult {
    const scope = `#${order.orderNumber}${order.label ? ` ${order.label}` : ""}`;
    const pay = this.canPay && order.status === "placed";
    return html`
      <div class="order" data-waiting-order=${order.id}>
        <div class="summary">
          <span class="number">#${order.orderNumber}</span>
          ${order.label ? html`<span class="label">${order.label}</span>` : nothing}
          <span class="state" data-waiting-state>${t(this.#state(order))}</span>
          <span class="meta">${formatMoney(order.total, currentLocale())}</span>
        </div>
        <div class="controls">
          ${
            pay
              ? html`<wt-button
                  data-waiting-pay
                  variant="primary"
                  aria-label=${`${t("action.pay")} ${scope}`}
                  @click=${() => this.#emit("pay-waiting-order", order)}
                  >${t("action.pay")}</wt-button
                >`
              : nothing
          }
          ${
            order.canHandOver
              ? html`<wt-button
                  data-waiting-hand-over
                  variant=${pay ? "secondary" : "primary"}
                  aria-label=${`${t("waiting.hand_over")} ${scope}`}
                  @click=${() => this.#emit("hand-over-order", order)}
                  >${t("waiting.hand_over")}</wt-button
                >`
              : nothing
          }
        </div>
      </div>
    `;
  }

  override render() {
    if (this.orders.length === 0) return nothing;
    return html`
      <h2 class="title">${t("waiting.title")}</h2>
      ${this.orders.map((order) => this.#row(order))}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-waiting": TillCounterWaiting;
  }
}
