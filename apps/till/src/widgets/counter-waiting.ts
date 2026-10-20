import { orderLabel } from "./order-label.js";
import { orderPreview, orderPreviewStyles } from "./order-preview.js";
import { LitElement, css, html, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { orderNumber, orderNumberStyles } from "./order-number.js";
import { helpAnchorStyles, helpBadge } from "./help-badge.js";
import type { StringKey } from "../i18n/strings.js";
import type { CounterWaitingOrder } from "../api/client.js";

/** A `pay-waiting-order` event's detail: the order, and the mode its payment is taken in. */
export interface PayWaitingOrderDetail {
  id: string;
  serviceMode: CounterWaitingOrder["serviceMode"];
}

/** How the row's buttons' names and the move dialog's heading name the order: `#12 Mesa 4`. */
export function waitingScope(order: CounterWaitingOrder): string {
  const label = orderLabel(order);
  return `#${order.orderNumber}${label ? ` ${label}` : ""}`;
}

/**
 * The counter orders still waiting on the counter: sent and not paid, or paid and not handed over
 * (spec §5, "Counter service"). A pure view that renders nothing when no order waits; the app turns
 * its `hand-over-order` and `pay-waiting-order` events into API calls, its
 * `cancel-credit-waiting-order` event into the cancel and credit dialog, and its
 * `move-waiting-order` event into the move-to-station dialog.
 */
@customElement("till-counter-waiting")
export class TillCounterWaiting extends LitElement {
  static override styles = [
    baseStyles,
    orderPreviewStyles,
    orderNumberStyles,
    helpAnchorStyles,
    css`
      :host {
        display: block;
      }

      .title-anchor {
        width: fit-content;
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
  /** The device's profile allows `take-orders`, which the move route requires. */
  @property({ type: Boolean }) canMoveStation = false;

  @property({ type: Boolean }) canEditKitchenNote = false;

  @state() private expanded = new Set<string>();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("orders")) {
      const ids = new Set(this.orders.map((order) => order.id));
      this.expanded = new Set([...this.expanded].filter((id) => ids.has(id)));
    }
  }

  #togglePreview(event: Event, id: string): void {
    if (
      event
        .composedPath()
        .some((target) => target instanceof Element && target.classList.contains("controls"))
    )
      return;
    const next = new Set(this.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded = next;
  }

  #emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #state(order: CounterWaitingOrder): StringKey {
    if (order.status === "settled") return "waiting.paid_not_handed_over";
    return order.collectedAt === null ? "waiting.sent_not_paid" : "waiting.handed_over_not_paid";
  }

  #row(order: CounterWaitingOrder): TemplateResult {
    const scope = waitingScope(order);
    const label = orderLabel(order);
    const pay = order.status === "placed";
    return html`
      <div
        class="order"
        data-waiting-order=${order.id}
        @click=${(event: Event) => this.#togglePreview(event, order.id)}
      >
        <button
          type="button"
          class="summary"
          aria-expanded=${String(this.expanded.has(order.id))}
          aria-controls=${`preview-${order.id}`}
        >
          <span class="number">${orderNumber(order.orderNumber, order.formerNumbers)}</span>
          ${label ? html`<span class="label">${label}</span>` : nothing}
          <span class="state" data-waiting-state>${t(this.#state(order))}</span>
          <span class="meta">${formatMoney(order.total, currentLocale())}</span>
        </button>
        <div class="controls">
          ${
            this.canEditKitchenNote && order.collectedAt === null
              ? html`<wt-button
                  data-waiting-kitchen-note
                  variant="secondary"
                  aria-label=${`${t("kitchen_note.title")} ${scope}`}
                  @click=${() => this.#emit("edit-waiting-kitchen-note", { id: order.id })}
                  >${t("kitchen_note.title")}</wt-button
                >`
              : nothing
          }
          ${
            pay
              ? html`<wt-button
                  data-waiting-pay
                  variant="primary"
                  aria-label=${`${t("action.pay")} ${scope}`}
                  @click=${() =>
                    this.#emit("pay-waiting-order", {
                      id: order.id,
                      serviceMode: order.serviceMode,
                    } satisfies PayWaitingOrderDetail)}
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
                  @click=${() => this.#emit("hand-over-order", { id: order.id })}
                  >${t("waiting.hand_over")}</wt-button
                >`
              : nothing
          }
          ${
            this.canMoveStation && !pay && order.movableDishes.length > 0
              ? html`<wt-button
                  data-waiting-move-station
                  variant="secondary"
                  aria-label=${`${t("table.move_station")} ${scope}`}
                  @click=${() => this.#emit("move-waiting-order", { id: order.id })}
                  >${t("table.move_station")}</wt-button
                >`
              : nothing
          }
          ${
            pay && order.invoiceNumber !== undefined
              ? html`<wt-button
                  data-waiting-cancel-credit
                  variant="secondary"
                  aria-label=${`${t("cancel_credit.action")} ${scope}`}
                  @click=${() => this.#emit("cancel-credit-waiting-order", { id: order.id })}
                  >${t("cancel_credit.action")}</wt-button
                >`
              : nothing
          }
        </div>
        <div
          class="order-preview"
          id=${`preview-${order.id}`}
          ?hidden=${!this.expanded.has(order.id)}
        >
          ${this.expanded.has(order.id) ? orderPreview(order.items) : nothing}
        </div>
      </div>
    `;
  }

  override render() {
    if (this.orders.length === 0) return nothing;
    return html`
      <div class="title-anchor help-anchor">
        <h2 class="title">${t("waiting.title")}</h2>
        ${helpBadge("help.counter.waiting_orders", t("waiting.title"))}
      </div>
      ${this.orders.map((order) => this.#row(order))}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-counter-waiting": TillCounterWaiting;
  }
}
