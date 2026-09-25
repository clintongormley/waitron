import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import { baseStyles } from "@waitron/ui";
import { FALLBACK_LOCALE } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { dietBadgeStyles, dietBadges } from "../widgets/diet-badges.js";
import { customerProductName, productName } from "../widgets/product-name.js";
import type { TillProduct } from "../api/client.js";
import type { AllergenCode } from "@waitron/catalogue/src/allergens.js";

/**
 * The matrix's column order and the order the detail dialog lists a product's declarations.
 *
 * Redefined LOCALLY rather than imported from `@waitron/catalogue`'s `ALLERGEN_CODES`: a runtime import
 * would drag that package's barrel, and through it `@waitron/db` and Node builtins, into the browser
 * bundle. `till-allergen-screen.test.ts` pins this array's code SET to `ALLERGEN_NAMES`, whose own suite
 * pins it to `ALLERGEN_CODES`; the order is not checked.
 */
export const ALLERGEN_DISPLAY_ORDER: readonly AllergenCode[] = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

type AllergenPresence = NonNullable<TillProduct["allergens"]>[string];

type Chrome = "title" | "notice" | "pending" | "contains" | "may_contain" | "print" | "close";

/**
 * The ALLERGEN SCREEN: a product × allergen matrix, a per-product detail dialog and a print path.
 *
 * The three declaration states stay DISTINCT, because conflating them is a food-safety hazard:
 *  - `allergens === null` — NOT reviewed, rendered as "pending", NEVER as an all-clear row: fourteen
 *    blank cells would read as "reviewed, contains none of them".
 *  - `allergens === {}` — reviewed, none declared: genuinely all-clear.
 *  - `allergens === { code: {…} }` — reviewed with declarations.
 *
 * On screen the matrix renders in the OPERATOR locale ({@link locale}); a Print re-renders in the
 * INVOICE locale ({@link invoiceLocale}), because the printed sheet is a customer document. Product
 * names differ between the two renders by more than language: see `#productLabel`.
 */
@customElement("till-allergen-screen")
export class TillAllergenScreen extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    dietBadgeStyles,
    css`
      :host {
        display: block;
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }

      .titles {
        min-width: 0;
      }

      .title {
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      .notice {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .actions {
        display: flex;
        gap: var(--wt-space-2);
        flex-shrink: 0;
      }

      /* A wide matrix (a product column + fourteen allergen columns) scrolls INSIDE its own box rather
         than pushing the screen sideways. */
      .matrix-scroll {
        overflow-x: auto;
      }

      .matrix {
        border-collapse: collapse;
        width: 100%;
        font-variant-numeric: tabular-nums;
      }

      .matrix th,
      .matrix td {
        padding: var(--wt-space-2);
        border-bottom: 1px solid var(--wt-color-border);
        text-align: center;
      }

      .col-head {
        vertical-align: bottom;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
      }

      .product {
        text-align: left;
        white-space: nowrap;
      }

      .row-open {
        display: block;
      }

      .pending-cell {
        color: var(--wt-color-text-muted);
        font-style: italic;
        text-align: left;
      }

      .marker {
        font-size: var(--wt-font-size-lg);
        line-height: 1;
      }

      .cell.contains .marker {
        color: var(--wt-color-danger);
      }

      .cell.may-contain .marker {
        color: var(--wt-color-text-muted);
      }

      .detail-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .detail-item {
        display: flex;
        gap: var(--wt-space-2);
        align-items: baseline;
      }

      .detail-presence {
        flex-shrink: 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .detail-item.may-contain .detail-presence {
        color: var(--wt-color-text-muted);
      }

      .detail-pending,
      .detail-none {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      /* The product's DIET summary (dietary-classification, Task 7) in the detail dialog — the published
         profile's vegan/vegetarian/halal/kosher badges + contains chips (and the neutral "not reviewed"
         note when pending), set off from the allergen list above by a divider. The badge/chip look comes
         from the shared dietBadgeStyles. */
      .detail-diet {
        margin-top: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }
    `,
  ];

  @property({ attribute: false }) products: TillProduct[] = [];
  @property() locale: string = FALLBACK_LOCALE;
  @property() invoiceLocale = "es-ES";

  @state() private selected?: TillProduct;
  /** True only for the one render {@link updated} hands to the browser's print. */
  @state() private printing = false;

  #activeLocale(): string {
    return this.printing ? this.invoiceLocale : this.locale;
  }

  #t(key: Chrome): string {
    return t(`allergens.${key}`, this.#activeLocale());
  }

  /**
   * A product's name for the render in hand. The PRINTED sheet is a customer document (RD 126/2015
   * Art. 6.5.a.2° puts the record in front of consumers as well as staff and inspectors), so it
   * names dishes the way the customer menu does and in the invoice locale — otherwise a diner
   * matching a dish on the menu to a row here finds no row that matches. On screen this is an
   * operator lookup, so it reads the venue's own staff name.
   */
  #productLabel(product: TillProduct): string {
    return this.printing ? customerProductName(product, this.invoiceLocale) : productName(product);
  }

  #openDetail(product: TillProduct): void {
    this.selected = product;
  }

  #closeDetail(): void {
    this.selected = undefined;
  }

  #print(): void {
    this.printing = true;
  }

  #close(): void {
    this.dispatchEvent(new CustomEvent("close-allergens", { bubbles: true, composed: true }));
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("printing") && this.printing) {
      globalThis.print?.();
      // Drop the latch straight back so a SECOND Print tap flips false→true again and re-fires: a latch
      // left true would set true→true, Lit would see no change, and nothing would print.
      this.printing = false;
    }
  }

  #cell(code: string, entry: AllergenPresence | undefined) {
    if (!entry) {
      return html`<td class="cell" data-code=${code}></td>`;
    }
    const contains = entry.presence === "contains";
    const label = contains ? this.#t("contains") : this.#t("may_contain");
    return html`<td class="cell ${contains ? "contains" : "may-contain"}" data-code=${code}>
      <span class="marker" role="img" aria-label=${label}>${contains ? "●" : "○"}</span>
    </td>`;
  }

  #row(product: TillProduct) {
    const name = this.#productLabel(product);
    const open = html`<wt-button
      class="row-open"
      variant="ghost"
      @click=${() => this.#openDetail(product)}
    >
      ${name}
    </wt-button>`;
    if (product.allergens === null) {
      return html`<tr class="row pending">
        <th scope="row" class="product">${open}</th>
        <td class="pending-cell" colspan=${ALLERGEN_DISPLAY_ORDER.length}>${this.#t("pending")}</td>
      </tr>`;
    }
    const declared = product.allergens;
    return html`<tr class="row reviewed">
      <th scope="row" class="product">${open}</th>
      ${ALLERGEN_DISPLAY_ORDER.map((code) => this.#cell(code, declared[code]))}
    </tr>`;
  }

  #detailItem(code: string, entry: AllergenPresence) {
    const contains = entry.presence === "contains";
    const label = contains ? this.#t("contains") : this.#t("may_contain");
    const name = allergenName(code, this.#activeLocale());
    const text = entry.source ? `${name} (${entry.source})` : name;
    return html`<li class="detail-item ${contains ? "contains" : "may-contain"}">
      <span class="detail-presence">${label}</span>
      <span class="detail-name">${text}</span>
    </li>`;
  }

  #detailBody(product: TillProduct) {
    const declared = product.allergens;
    if (declared === null) {
      return html`<p class="detail-pending">${this.#t("pending")}</p>`;
    }
    // Iterate in ALLERGEN_DISPLAY_ORDER, not `Object.entries(declared)`: the dialog lists declarations
    // in the matrix's column order, never the server's JSON key order.
    const codes = ALLERGEN_DISPLAY_ORDER.filter((code) => declared[code]);
    if (codes.length === 0) {
      return html`<p class="detail-none">${this.#t("notice")}</p>`;
    }
    return html`<ul class="detail-list">
      ${codes.map((code) => this.#detailItem(code, declared[code]))}
    </ul>`;
  }

  /** The PUBLISHED `product.diet`, never a per-line as-served fold: this screen is a per-product lookup. */
  #detailDiet(product: TillProduct) {
    const badges = dietBadges(product.diet, "detail-diet", this.#activeLocale());
    if (badges === nothing) return nothing;
    return html`<div class="detail-diet">${badges}</div>`;
  }

  /** Always present, driven by `selected`, so Escape closes flow back through `wt-close` into
   * `selected` rather than fighting the `.open` binding. */
  #detail() {
    const product = this.selected;
    return html`<wt-dialog
      class="detail"
      .open=${product !== undefined}
      .heading=${product ? this.#productLabel(product) : ""}
      @wt-close=${() => this.#closeDetail()}
    >
      ${product ? this.#detailBody(product) : nothing}
      ${product ? this.#detailDiet(product) : nothing}
      <wt-button
        slot="footer"
        class="detail-close"
        variant="secondary"
        @click=${() => this.#closeDetail()}
      >
        ${this.#t("close")}
      </wt-button>
    </wt-dialog>`;
  }

  override render() {
    const activeLocale = this.#activeLocale();
    return html`
      <wt-card class="screen">
        <header class="head">
          <div class="titles">
            <h1 class="title">${this.#t("title")}</h1>
            <p class="notice">${this.#t("notice")}</p>
          </div>
          <div class="actions">
            <wt-button class="print" variant="secondary" @click=${() => this.#print()}>
              ${this.#t("print")}
            </wt-button>
            <wt-button class="close" variant="secondary" @click=${() => this.#close()}>
              ${this.#t("close")}
            </wt-button>
          </div>
        </header>
        <div class="matrix-scroll">
          <table class="matrix">
            <thead>
              <tr>
                <td class="corner"></td>
                ${ALLERGEN_DISPLAY_ORDER.map(
                  (code) =>
                    html`<th scope="col" class="col-head">${allergenName(code, activeLocale)}</th>`,
                )}
              </tr>
            </thead>
            <tbody>
              ${this.products.map((product) => this.#row(product))}
            </tbody>
          </table>
        </div>
      </wt-card>
      ${this.#detail()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-allergen-screen": TillAllergenScreen;
  }
}
