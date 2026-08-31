import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { productName } from "./product-name.js";
import { descriptionFor } from "./dish-format.js";
import { dishGross, optionGross, quantityLabel } from "../state/order-line.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";

/**
 * The multiplication sign for a per-option-quantity badge (`×2`). The SAME `×` (U+00D7) the printed
 * receipt (`apps/server/src/receipt-ticket.ts`) and the settled-ticket view use, so the badge reads
 * identically on the screen basket, the paper receipt and the filed ticket.
 */
const QTY_BADGE = "×";

/**
 * The `×N` badge for a modifier taken more than once per dish (per-option quantity), or "" for the
 * common one-per-dish case (quantity 1 or absent) so a plain option renders byte-identical to before.
 * `quantity` is the CLIENT per-dish count carried directly on the selected option — no derivation.
 */
function optionQuantityBadge(quantity: number | undefined): string {
  return quantity !== undefined && quantity > 1 ? ` ${QTY_BADGE}${quantity}` : "";
}

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

      /* Dish-line quantity stepper (feature B): the -/N/+ control on an each line. The count sits
         between the two step buttons; a weight line renders the static kg label in this same cell. */
      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .count {
        min-width: 1.5ch;
        text-align: center;
        font-variant-numeric: tabular-nums;
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
            ${this.#quantityCell(line, index)}
            <span class="line-total">${formatMoney(dishGross(line))}</span>
            <wt-button
              class="remove"
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
            // which drops the whole line (options and all). A modifier taken more than once per dish
            // (per-option quantity) shows a "×N" badge on its name — the CLIENT per-dish count carried
            // directly on the option (no derivation); a plain option (quantity 1/absent) is unchanged.
            (option) => html`
              <div class="option">
                <span class="name"
                  >${descriptionFor(option.name, "")}${optionQuantityBadge(option.quantity)}</span
                >
                <span class="option-total">${formatMoney(optionGross(line, option))}</span>
              </div>
            `,
          )}
        `,
      )}
    `;
  }

  /**
   * The line's quantity cell. An `each` line gets a −/count/+ stepper (dish-line quantity, feature B):
   * `+` bumps the count via {@link WorkingOrderStore.setLineQuantity} (no line merge — each add stays its
   * own line), `−` lowers it but is DISABLED at 1 because deletion is the × remove control's job, never
   * the stepper's. A `weight` line has no stepper — a measured weight has no +/- — so it keeps the static
   * kg label ({@link quantityLabel}).
   */
  #quantityCell(line: OrderLine, index: number) {
    if (line.product.pricingUnit === "weight") {
      return html`<span class="qty">${quantityLabel(line)}</span>`;
    }
    const count = Number(line.quantity);
    const name = productName(line.product);
    return html`
      <span class="qty stepper">
        <wt-button
          class="step step-dec"
          variant="ghost"
          size="sm"
          aria-label=${`${t("basket.decrease")} ${name}`}
          ?disabled=${count <= 1}
          @click=${() => this.store.setLineQuantity(index, String(count - 1))}
        >
          <span aria-hidden="true">−</span>
        </wt-button>
        <span class="count">${line.quantity}</span>
        <wt-button
          class="step step-inc"
          variant="ghost"
          size="sm"
          aria-label=${`${t("basket.increase")} ${name}`}
          @click=${() => this.store.setLineQuantity(index, String(count + 1))}
        >
          <span aria-hidden="true">+</span>
        </wt-button>
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-basket": TillBasket;
  }
}
