import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { MONEY_SCALE, decimal, multiplyDecimal, toScale } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { productName } from "./product-name.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";

/**
 * The running order: one row per rung-up line, each with the product's name, the quantity (a count,
 * or a kg weight for a weight product) and its gross line total, plus a remove control. It reads the
 * store and re-renders on every `"changed"` event — it holds no basket state of its own, so it can
 * never disagree with the store the pay flow reads.
 *
 * The line total is the SAME arithmetic the server prices with — `unitPrice × quantity` at money
 * scale, in `@waitron/shared` Decimals, never a float — so a row can never round differently from
 * the grand total or the filed ticket.
 */
@customElement("till-basket")
export class TillBasket extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .line {
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .qty {
        color: var(--wt-color-text-muted);
      }

      .line-total {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  /** The order this basket shows and mutates. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  /** Disposes the store subscription taken in {@link connectedCallback}. */
  #unsubscribe?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    // Re-render on any basket change (add / remove / clear). The dispose fn is kept for teardown.
    this.#unsubscribe = this.store.subscribe(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  /** How much of this line: `"N kg"` for a weight product, the bare count for an `each` product. */
  #quantityLabel(line: OrderLine): string {
    return line.product.pricingUnit === "weight" ? `${line.quantity} kg` : line.quantity;
  }

  /** Gross line total = `unitPrice × quantity`, rounded to money scale, then formatted for display. */
  #lineTotal(line: OrderLine): string {
    const gross = toScale(
      multiplyDecimal(decimal(line.product.unitPrice), decimal(line.quantity)),
      MONEY_SCALE,
    );
    return formatMoney(gross);
  }

  override render() {
    const lines = this.store.lines;
    if (lines.length === 0) {
      return html`<p class="empty">${t("basket.empty")}</p>`;
    }
    return html`
      ${lines.map(
        (line, index) => html`
          <div class="line">
            <span class="name">${productName(line.product)}</span>
            <span class="qty">${this.#quantityLabel(line)}</span>
            <span class="line-total">${this.#lineTotal(line)}</span>
            <wt-button
              variant="ghost"
              size="sm"
              aria-label=${`${t("action.remove")} ${productName(line.product)}`}
              @click=${() => this.store.removeLine(index)}
            >
              <span aria-hidden="true">×</span>
            </wt-button>
          </div>
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-basket": TillBasket;
  }
}
