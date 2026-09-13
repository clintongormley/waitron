import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { productName, productUnit, unitName } from "./product-name.js";
import "./modifier-picker.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import type { TillProduct } from "../api/client.js";
import { toWireLineExtras } from "../state/order-line.js";
import type { WorkingOrderStore } from "../state/working-order.js";

/**
 * The wall of tappable product tiles — the till's primary input surface. One `<wt-button>` per
 * product (44px tap target + focus ring for free), showing the product's name in the current locale
 * and its price. Tiles coordinate only through the store (spec §3): they never reference the basket
 * or total widgets.
 *
 * Tapping is driven by the selected unit:
 *  - a whole, non-hardware tile with NO modifier groups rings up one straight away —
 *    `store.addProduct(product, "1")`, byte-identical to before (the common tap);
 *  - a whole, non-hardware tile with option groups (ordering modifiers, Task 10) opens the
 *    modifier picker instead, and rings the dish with the chosen options once the diner confirms;
 *  - a fractional or hardware-mapped tile needs quantity entry, so it BROADCASTS the pick
 *    (`emit("product-selected", …)`) for the keypad. It does not touch the basket itself.
 */
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

  /** The product whose modifier picker is currently open, or `undefined` when none is. Set when an
   * whole, non-hardware product WITH a non-empty group is tapped; cleared on confirm or cancel. */
  @state() private pickerProduct?: TillProduct;

  /** Price text for a tile: a money string suffixed by the localized selected unit. */
  #priceLabel(product: TillProduct): string {
    const price = formatMoney(product.unitPrice);
    return `${price}/${unitName(product)}`;
  }

  #hasModifiers(product: TillProduct): boolean {
    if ((product.variants ?? []).some((variant) => variant.available)) return true;
    if (product.modifiers !== undefined)
      return product.modifiers.some((modifier) => modifier.available);
    return (product.optionGroups ?? []).some((group) => group.items.length > 0);
  }

  /**
   * Ring up a whole, non-hardware pick, or open its modifier picker when it carries options;
   * broadcast any fractional or hardware-mapped pick for quantity entry.
   */
  #pick(product: TillProduct): void {
    const unit = productUnit(product);
    if (unit.hardwareUnit !== null || unit.precision > 0) {
      this.store.emit("product-selected", product);
    } else if (this.#hasModifiers(product)) {
      this.pickerProduct = product;
    } else {
      this.store.addProduct(product, "1");
    }
  }

  #onModifierConfirm(detail: ModifierConfirmDetail): void {
    // Forward the picker's per-line note/doneness (order-line customisation) through the ONE
    // `toWireLineExtras` mapping (`detail` satisfies its minimal `{ note?; doneness? }` shape), each key
    // present only when the picker set it. The result may be an empty `{}`, which `addProduct` treats
    // exactly like `undefined`, so a note-free, doneness-free confirm leaves the line byte-identical.
    this.store.addProduct(
      detail.product,
      "1",
      detail.options.length > 0 ? detail.options : undefined,
      {
        ...toWireLineExtras(detail),
        ...(detail.modifierSelections === undefined
          ? {}
          : {
              modifierSelections: detail.modifierSelections,
              modifierSnapshots: detail.modifierSnapshots,
            }),
      },
    );
    this.pickerProduct = undefined;
  }

  override render() {
    // When `columns` is set, override the responsive default with a fixed N equal-width columns;
    // unset, `nothing` removes the inline attribute so the stylesheet's auto-fill grid governs.
    const gridStyle =
      this.columns === undefined ? nothing : `grid-template-columns: repeat(${this.columns}, 1fr);`;
    return html`
      <div class="grid" style=${gridStyle}>
        ${this.products.map(
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
