import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { productName } from "./product-name.js";
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
 * Tapping is priced by unit:
 *  - an `each` tile with NO modifier groups rings up one of that product straight away —
 *    `store.addProduct(product, "1")`, byte-identical to before (the common tap);
 *  - an `each` tile that carries a non-empty option group (ordering modifiers, Task 10) opens the
 *    modifier picker instead, and rings the dish with the chosen options once the diner confirms;
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

  /**
   * The per-card config key `product-grid.columns`: fix the grid to exactly this many equal-width
   * columns. Unset (the default) keeps the responsive `repeat(auto-fill, minmax(9rem, 1fr))` grid in the
   * stylesheet below. Threaded from the card by `till-card-grid`, which narrows the config bag's
   * `unknown` to a number; the value's 1..12 bound is stated by the per-card contract server-side
   * (`@waitron/layouts` `CARD_CONTRACTS`), so the interpolation below is a plain integer, never free text.
   */
  @property({ type: Number }) columns?: number;

  /** The product whose modifier picker is currently open, or `undefined` when none is. Set when an
   * `each` product WITH a non-empty group is tapped; cleared on confirm or cancel. */
  @state() private pickerProduct?: TillProduct;

  /** Price text for a tile: a plain money string, suffixed `/kg` when the product is sold by weight. */
  #priceLabel(product: TillProduct): string {
    const price = formatMoney(product.unitPrice);
    return product.pricingUnit === "weight" ? `${price}/kg` : price;
  }

  /** Whether a product has any group worth picking from — a group with active items. A product with no
   * groups, or only EMPTY groups (all items inactive, an authoring bug), has nothing to pick, so it
   * rings up straight away rather than opening a pointless dialog (CLAUDE.md §5 — nothing wedges a sale). */
  #hasModifiers(product: TillProduct): boolean {
    return (product.optionGroups ?? []).some((group) => group.items.length > 0);
  }

  /**
   * Ring up an `each` pick, or open its modifier picker when it carries options; broadcast a `weight`
   * pick for the kg keypad to complete. The `weight` path is unchanged — a weight product never opens
   * the picker (options on a weight line are refused server-side).
   */
  #pick(product: TillProduct): void {
    if (product.pricingUnit !== "each") {
      this.store.emit("product-selected", product);
    } else if (this.#hasModifiers(product)) {
      this.pickerProduct = product;
    } else {
      this.store.addProduct(product, "1");
    }
  }

  /**
   * Ring the configured dish with its chosen options, then close the picker. An EMPTY selection (every
   * group was optional and left blank) adds with NO `options` — passing `undefined`, not `[]`, so a
   * grouped-but-unmodified dish is byte-identical to a plain ring-up (`addProduct` stores an `[]`
   * verbatim, so the empty case must be collapsed here).
   */
  #onModifierConfirm(detail: ModifierConfirmDetail): void {
    // Forward the picker's per-line note/doneness (order-line customisation) through the ONE
    // `toWireLineExtras` mapping (`detail` satisfies its minimal `{ note?; doneness? }` shape), each key
    // present only when the picker set it. The result may be an empty `{}`, which `addProduct` treats
    // exactly like `undefined`, so a note-free, doneness-free confirm leaves the line byte-identical.
    this.store.addProduct(
      detail.product,
      "1",
      detail.options.length > 0 ? detail.options : undefined,
      toWireLineExtras(detail),
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
              @modifier-confirm=${(e: CustomEvent<ModifierConfirmDetail>) =>
                this.#onModifierConfirm(e.detail)}
              @modifier-cancel=${() => {
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
