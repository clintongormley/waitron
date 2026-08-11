import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { allergenStateName, unitName, vatClassName } from "../i18n/domain.js";
import type { AllergenDeclaration, Product } from "../api/client.js";

/** The three allergen-declaration states the pill renders, keyed off the §7 / §1 invariant. */
type AllergenState = "pending" | "none" | "declared";

/**
 * The three-state read of a product's allergen declaration (design §7, the till's null/{}/{…}
 * distinction — `apps/till/src/screens/till-allergen-screen.ts`): `null` is PENDING (not yet
 * reviewed — a compliance gap, NEVER "allergen-free"), `{}` is reviewed-with-none, a non-empty map is
 * declared. `null` and `{}` MUST stay distinct — collapsing them is the exact defect the invariant
 * exists to prevent, so it is a `=== null` test, not a falsy/length-only one.
 */
function allergenState(allergens: AllergenDeclaration): AllergenState {
  if (allergens === null) return "pending";
  return Object.keys(allergens).length === 0 ? "none" : "declared";
}

/**
 * The management dashboard's PRODUCT LIST: one `wt-card` row per product showing its name (from
 * `descriptions[primaryLocale]`, degrading gracefully when that locale is absent), gross `unitPrice` +
 * `pricingUnit`, `vatClass`, an active/inactive badge, an allergen-state pill (the three states
 * PENDING/none/declared), and a thumbnail served from `/media/<image>` OR a placeholder when there is
 * no picture. An Edit control per row emits `edit-product { productId }`.
 *
 * It is a PURE DISPLAY widget — it holds no state and never talks to the API (like `staff-list`, unlike
 * the login screen). The catalogue screen owns the list (`DashboardApi.listProducts`) and hands it
 * down as `products`; the Edit control emits a composed, bubbling `edit-product` carrying only the
 * `productId`, which the screen turns into an edit flow.
 *
 * Everything that carries meaning does so in TEXT, not colour alone (a11y): the active badge names its
 * state, the allergen pill's three states read as three different words, and the thumbnail's `alt` is
 * the product name. `vatClass`/`pricingUnit` and the allergen state render through the i18n layer as
 * localised display names (`vatClassName`/`unitName`/`allergenStateName`) at the render edge, exactly
 * as `staff-list` translates its role/status tokens; `data-state`/`data-active` stay the raw tokens.
 */
@customElement("dashboard-product-list")
export class ProductList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .main {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        min-width: 0;
      }

      /* The thumbnail and its placeholder share the same box so rows line up whether or not a product
         carries a picture. The 1px hairline matches wt-card/wt-input's own borders. */
      .thumb,
      .thumb-placeholder {
        flex: none;
        width: 48px;
        height: 48px;
        border-radius: var(--wt-radius-md);
        border: 1px solid var(--wt-color-border);
        overflow: hidden;
        background: var(--wt-color-surface);
      }

      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }

      .meta {
        display: flex;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-1);
      }

      /* A bordered text pill: the label carries the meaning, so nothing here depends on colour to be
         understood (the staff-list badge convention). The wt-color-text token on the card surface is
         the highest-contrast pairing in both themes. */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /** The products to list, straight from `DashboardApi.listProducts`. The screen owns and refreshes
   * it; defaults to empty so the widget renders safely before the screen assigns the list. */
  @property({ attribute: false }) products: Product[] = [];

  /**
   * The locale to prefer for a product's display name — `descriptions[primaryLocale]`, degrading to
   * any other description, then the id (the `productName` approach, `apps/till/src/widgets/
   * product-name.ts`). Defaults to `"es"`; the screen may pass the venue's configured locale.
   */
  @property() primaryLocale = "es";

  /** The display name in `primaryLocale`, falling back to any other description, then the id — a name
   * in the wrong language beats a blank row, and a bare id beats nothing at all. */
  #name(product: Product): string {
    return (
      product.descriptions[this.primaryLocale] ??
      Object.values(product.descriptions)[0] ??
      product.id
    );
  }

  /**
   * Ask the catalogue screen to edit `productId`. `stopPropagation` keeps the button's own composed
   * `click` inside this widget's shadow boundary, so the consumer hears the semantic `edit-product`
   * and not a raw click as well (the house pattern — `staff-list` stops its composed events the same
   * way). Dispatched `bubbles`+`composed` so it crosses the boundary to the screen.
   */
  #edit(event: Event, productId: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ productId: string }>("edit-product", {
        detail: { productId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const editLabel = t("action.edit"); // locale-invariant across rows — resolve once per render
    return html`
      <div class="list">
        ${this.products.map((product) => {
          const name = this.#name(product);
          const state = allergenState(product.allergens);
          return html`
            <wt-card data-test="row">
              <div class="row">
                <div class="main">
                  ${
                    product.image === null
                      ? html`<div
                          class="thumb-placeholder"
                          data-test="thumb-placeholder"
                          aria-hidden="true"
                        ></div>`
                      : html`<span class="thumb" data-test="thumb"
                          ><img src=${`/media/${product.image}`} alt=${name}
                        /></span>`
                  }
                  <div class="details">
                    <span class="name">${name}</span>
                    <span class="meta">
                      <span class="price"
                        >${product.unitPrice} ${unitName(product.pricingUnit)}</span
                      >
                      <span class="vat">${vatClassName(product.vatClass)}</span>
                    </span>
                    <span class="badges">
                      <span
                        class="badge"
                        data-test="active-badge"
                        data-active=${product.active ? "true" : "false"}
                        >${product.active ? t("product.active_badge") : t("product.inactive_badge")}</span
                      >
                      <span class="badge" data-test="allergen-state" data-state=${state}
                        >${allergenStateName(state)}</span
                      >
                    </span>
                  </div>
                </div>
                <wt-button
                  variant="ghost"
                  data-test=${`edit-${product.id}`}
                  aria-label=${`${editLabel} ${name}`}
                  @click=${(event: Event) => this.#edit(event, product.id)}
                >
                  ${editLabel}
                </wt-button>
              </div>
            </wt-card>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-list": ProductList;
  }
}
