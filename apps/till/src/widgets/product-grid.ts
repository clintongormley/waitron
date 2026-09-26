import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { productName, productUnit, unitName } from "./product-name.js";
import "./modifier-picker.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import type { TillProduct } from "../api/client.js";
import { needsModifierPicker } from "../state/order-line.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale } from "../i18n/t.js";

/** A product with variants is sold only as one of them, so one whose variants are all unavailable
 * here has nothing to sell and gets no tile. */
function hasSomethingToSell(product: TillProduct): boolean {
  const variants = product.variants ?? [];
  return variants.length === 0 || variants.some((variant) => variant.available);
}

/** Tiles coordinate only through the store: they never reference the basket or total widgets. */
@customElement("till-product-grid")
export class TillProductGrid extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

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

  @property({ attribute: false }) products: TillProduct[] = [];

  @property({ attribute: false }) store!: WorkingOrderStore;

  @property({ type: Number }) columns?: number;

  @state() private pickerProduct?: TillProduct;

  #priceLabel(product: TillProduct): string {
    const price = formatMoney(product.unitPrice, currentLocale());
    return `${price}/${unitName(product)}`;
  }

  #pick(product: TillProduct): void {
    const unit = productUnit(product);
    if (unit.hardwareUnit !== null || unit.precision > 0) {
      this.store.emit("product-selected", product);
    } else if (needsModifierPicker(product)) {
      this.pickerProduct = product;
    } else {
      this.store.addProduct(product, "1");
    }
  }

  #onModifierConfirm(detail: ModifierConfirmDetail): void {
    this.store.addProduct(detail.product, "1", detail);
    this.pickerProduct = undefined;
  }

  override render() {
    // `nothing` removes the inline attribute, so the stylesheet's auto-fill grid governs.
    const gridStyle =
      this.columns === undefined ? nothing : `grid-template-columns: repeat(${this.columns}, 1fr);`;
    return html`
      <div class="grid" style=${gridStyle}>
        ${this.products.filter(hasSomethingToSell).map(
          (product) => html`
            <wt-button class="tile" @click=${() => this.#pick(product)}>
              <span class="name">${productName(product)}</span>
              <span class="price">${this.#priceLabel(product)}</span>
            </wt-button>
          `,
        )}
      </div>
      ${
        this.pickerProduct
          ? html`<till-modifier-picker
              .product=${this.pickerProduct}
              @wt-modifier-confirm=${(e: CustomEvent<ModifierConfirmDetail>) =>
                this.#onModifierConfirm(e.detail)}
              @wt-modifier-cancel=${() => {
                this.pickerProduct = undefined;
              }}
            ></till-modifier-picker>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-product-grid": TillProductGrid;
  }
}
