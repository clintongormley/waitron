import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { productName, unitName } from "./product-name.js";
import { hasSomethingToSell, pickProduct } from "./product-pick.js";
import "./modifier-picker.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import type { TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale } from "../i18n/t.js";

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
    pickProduct(product, this.store, (picked) => {
      this.pickerProduct = picked;
    });
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
        ${this.products.map(
          (product) => html`
            <wt-button
              class="tile"
              ?disabled=${!hasSomethingToSell(product)}
              @click=${() => this.#pick(product)}
            >
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
