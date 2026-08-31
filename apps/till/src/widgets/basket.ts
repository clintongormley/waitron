import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { productName } from "./product-name.js";
import { descriptionFor } from "./dish-format.js";
import { dishGross, optionGross, quantityLabel } from "../state/order-line.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { WorkingOrderStore } from "../state/working-order.js";

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

      /* A selected option (ordering modifiers, Task 8) — indented beneath its dish, name left and
         delta right, with no quantity column and no remove control (a child is not independently
         deletable; removing the dish removes it). */
      .option {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-1) 0;
        padding-left: var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }

      .option-total {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  /** The order this basket shows and mutates. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  constructor() {
    super();
    // Re-render on any basket change (add / remove / clear); the controller owns the subscription
    // lifecycle. `() => this.store` is read lazily on connect, after the property is assigned.
    new StoreChangeController(this, () => this.store);
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
            <span class="qty">${quantityLabel(line)}</span>
            <span class="line-total">${formatMoney(dishGross(line))}</span>
            <wt-button
              variant="ghost"
              size="md"
              aria-label=${`${t("action.remove")} ${productName(line.product)}`}
              @click=${() => this.store.removeLine(index)}
            >
              <span aria-hidden="true">×</span>
            </wt-button>
          </div>
          ${(line.options ?? []).map(
            // Each selected modifier on its own indented row — the option's name and its delta (0,00 for
            // a free option). No remove control: a child is removed only by removing its dish above,
            // which drops the whole line (options and all).
            (option) => html`
              <div class="option">
                <span class="name">${descriptionFor(option.name, "")}</span>
                <span class="option-total">${formatMoney(optionGross(line, option))}</span>
              </div>
            `,
          )}
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
