import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { productName } from "./product-name.js";
import type { TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";

/**
 * The wall of tappable product tiles — the till's primary input surface. One `<wt-button>` per
 * product (44px tap target + focus ring for free), showing the product's name in the current locale
 * and its price. Tiles coordinate only through the store (spec §3): they never reference the basket
 * or total widgets.
 *
 * Tapping is priced by unit:
 *  - an `each` tile rings up one of that product straight away — `store.addProduct(product, "1")`;
 *  - a `weight` tile has no quantity yet, so it BROADCASTS the pick (`emit("product-selected", …)`)
 *    for the kg keypad (Task 15) to weigh and add. It does not touch the basket itself.
 */
@customElement("till-product-grid")
export class TillProductGrid extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        gap: var(--wt-space-3);
      }

      .tile {
        width: 100%;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
      }

      .price {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /** The sellable products to lay out, straight from `GET /api/products`. */
  @property({ attribute: false }) products: TillProduct[] = [];

  /** The order the tiles act on. Every tap goes through this store, never through a sibling widget. */
  @property({ attribute: false }) store!: WorkingOrderStore;

  /** Price text for a tile: a plain money string, suffixed `/kg` when the product is sold by weight. */
  #priceLabel(product: TillProduct): string {
    const price = formatMoney(product.unitPrice);
    return product.pricingUnit === "weight" ? `${price}/kg` : price;
  }

  /** Ring up an `each` pick; broadcast a `weight` pick for the kg keypad to complete. */
  #pick(product: TillProduct): void {
    if (product.pricingUnit === "each") {
      this.store.addProduct(product, "1");
    } else {
      this.store.emit("product-selected", product);
    }
  }

  override render() {
    return html`
      <div class="grid">
        ${this.products.map(
          (product) => html`
            <wt-button class="tile" @click=${() => this.#pick(product)}>
              <span class="name">${productName(product)}</span>
              <span class="price">${this.#priceLabel(product)}</span>
            </wt-button>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-product-grid": TillProductGrid;
  }
}
