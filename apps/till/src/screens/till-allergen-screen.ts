import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { productName } from "../widgets/product-name.js";
import type { TillProduct } from "../api/client.js";

/**
 * The 14 EU allergens (Regulation (EU) No 1169/2011, Annex II) in DISPLAY order — the matrix's column
 * order and the order the detail dialog lists a product's declarations.
 *
 * Redefined LOCALLY here rather than imported from `@waitron/catalogue`'s `ALLERGEN_CODES`, exactly as
 * `api/client.ts` redefines the server's response shapes: a runtime import from that package would drag
 * its barrel — and through it `@waitron/db` and Node builtins — into the browser bundle. The order
 * mirrors `i18n/allergen-names.ts` (Task 5), which the suite pins to catalogue's canonical list, so a
 * drift in either is caught: `till-allergen-screen.test.ts` asserts this array's key set equals
 * `Object.keys(ALLERGEN_NAMES)`.
 */
export const ALLERGEN_DISPLAY_ORDER = [
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

/** One product's declaration for a single allergen — the value type of `TillProduct.allergens`. */
type AllergenPresence = { presence: "contains" | "may_contain"; source?: string };

/** The short keys of the allergen-screen UI chrome (`allergens.<key>` in `strings.ts`). */
type Chrome =
  "open" | "title" | "notice" | "pending" | "contains" | "may_contain" | "print" | "close";

/**
 * The customer-facing ALLERGEN SCREEN — the operator's food-safety lookup (menu & allergens). A
 * product × 14-allergen matrix plus a per-product detail dialog and a print path, reachable from the
 * counter's "Allergens" button (`till-counter-screen`), never mixed in with the sellable product tiles.
 *
 * The three declaration states are deliberately DISTINCT, because conflating them is a food-safety
 * hazard:
 *  - `allergens === null` — NOT reviewed. Rendered as an explicit "pending" treatment, NEVER as an
 *    all-clear row. Fourteen blank cells would read as "reviewed, contains none of them"; a product
 *    nobody has checked must not make that claim.
 *  - `allergens === {}` — reviewed, none declared. A full, reviewed cell row, all fourteen blank —
 *    genuinely all-clear, and visibly different from pending.
 *  - `allergens === { code: {…} }` — reviewed with declarations. Each declared code shows contains /
 *    may-contain in its column; the row's detail dialog spells them out with their sources.
 *
 * LOCALE. On-screen the matrix renders in the OPERATOR locale ({@link locale}); a Print re-renders in
 * the INVOICE locale ({@link invoiceLocale}) before handing off to the browser, mirroring how
 * `till-ticket-view` renders the legal receipt in `invoiceLocale` independent of the operator UI — the
 * printed allergen sheet is a customer document, so it follows the customer's language. Product names
 * and the UI chrome resolve against the full region locale ("es-ES"), but ALLERGEN names resolve
 * against the language subtag ("es"): `allergenName` does an exact-key match and only carries `en`/`es`,
 * so `allergenName("milk", "es-ES")` would fall back to English — {@link nameLocale} reduces the region
 * tag so "es-ES" yields "Leche" (proven in the suite). `t()` accepts either, since its catalogues map
 * both `es` and `es-ES`.
 */
@customElement("till-allergen-screen")
export class TillAllergenScreen extends LitElement {
  static override styles = [
    baseStyles,
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
    `,
  ];

  /** The products to lay out, straight from `GET /api/products` (each carrying its `allergens`). */
  @property({ attribute: false }) products: TillProduct[] = [];
  /** The OPERATOR-UI locale the matrix renders in on-screen. Defaults to the deli's es-ES. */
  @property() locale = "es-ES";
  /** The INVOICE (customer) locale a Print re-renders in — the printed sheet's language, independent of
   * the operator UI, exactly like `till-ticket-view.invoiceLocale`. Defaults to the deli's es-ES. */
  @property() invoiceLocale = "es-ES";

  /** The product whose detail dialog is open, or `undefined` when none is. */
  @state() private selected?: TillProduct;
  /**
   * Whether the screen is currently rendering its PRINTABLE form (invoice locale). Flipped true by
   * {@link print}; {@link updated} then hands the committed render to the browser. Deliberately NOT
   * reverted — the sheet stays in the invoice locale until the operator leaves; reopening from the
   * counter re-mounts this element fresh in the operator locale.
   */
  @state() private printing = false;

  /** The locale in force for the current render — the invoice locale while printing, else the operator's. */
  #activeLocale(): string {
    return this.printing ? this.invoiceLocale : this.locale;
  }

  /** The language subtag of {@link activeLocale} for `allergenName` (which keys on `en`/`es` exactly, so
   * a region tag like "es-ES" must reduce to "es" or it falls back to English — see the class doc). */
  #nameLocale(): string {
    return this.#activeLocale().replace(/-.*$/, "");
  }

  /** Resolve one UI-chrome key in the active locale. */
  #t(key: Chrome): string {
    return t(`allergens.${key}`, this.#activeLocale());
  }

  /** Open the detail dialog for `product`. */
  #openDetail(product: TillProduct): void {
    this.selected = product;
  }

  /** Close the detail dialog — from its own Close button or when it closes itself (escape/backdrop);
   * clearing `selected` keeps our state in step with the dialog so it does not immediately reopen. */
  #closeDetail(): void {
    this.selected = undefined;
  }

  /** Enter the printable (invoice-locale) render; {@link updated} does the browser hand-off. */
  #print(): void {
    this.printing = true;
  }

  /** Ask the counter to close the screen and return to the sale. */
  #close(): void {
    this.dispatchEvent(new CustomEvent("close-allergens", { bubbles: true, composed: true }));
  }

  override updated(changed: PropertyValues): void {
    // The invoice-locale render has just committed; hand the printable sheet to the browser. This is
    // the moment-of-print the `till-ticket-view` invoice-locale path stands in for. Only when `printing`
    // has just become true — never on the first render (it starts false) or any unrelated update.
    if (changed.has("printing") && this.printing) {
      globalThis.print?.();
    }
  }

  /** One matrix cell: a contains/may-contain marker, or a blank for an undeclared allergen. The marker
   * is a `role="img"` graphic named for a screen reader; the table's row/column headers supply which
   * product and allergen it belongs to. */
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

  /** One product row: a tappable name that opens its detail, then either the pending treatment (never an
   * all-clear row) or the fourteen reviewed cells. */
  #row(product: TillProduct) {
    const name = productName(product, this.#activeLocale());
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

  /** One line of the detail dialog: the strength label plus the allergen name, with its source in
   * parentheses when known ("Cereals containing gluten (wheat)"). */
  #detailItem(code: string, entry: AllergenPresence) {
    const contains = entry.presence === "contains";
    const label = contains ? this.#t("contains") : this.#t("may_contain");
    const name = allergenName(code, this.#nameLocale());
    const text = entry.source ? `${name} (${entry.source})` : name;
    return html`<li class="detail-item ${contains ? "contains" : "may-contain"}">
      <span class="detail-presence">${label}</span>
      <span class="detail-name">${text}</span>
    </li>`;
  }

  /** The body of the detail dialog for `product`: pending, the ask-staff notice for a reviewed product
   * with nothing declared, or the list of declarations. */
  #detailBody(product: TillProduct) {
    const declared = product.allergens;
    if (declared === null) {
      return html`<p class="detail-pending">${this.#t("pending")}</p>`;
    }
    // Iterate in ALLERGEN_DISPLAY_ORDER, not `Object.entries(declared)`: the dialog must list
    // declarations in the SAME order as the matrix columns (and the order this const's doc guarantees),
    // never the server's JSON key order — a payload keyed `{ milk, gluten }` still lists gluten first.
    const codes = ALLERGEN_DISPLAY_ORDER.filter((code) => declared[code]);
    if (codes.length === 0) {
      return html`<p class="detail-none">${this.#t("notice")}</p>`;
    }
    return html`<ul class="detail-list">
      ${codes.map((code) => this.#detailItem(code, declared[code]))}
    </ul>`;
  }

  /** The per-product detail dialog. Always present, driven by `selected`, so escape/backdrop closes
   * flow back through `wt-close` into `selected` rather than fighting the `.open` binding. */
  #detail() {
    const product = this.selected;
    return html`<wt-dialog
      class="detail"
      .open=${product !== undefined}
      .heading=${product ? productName(product, this.#activeLocale()) : ""}
      @wt-close=${() => this.#closeDetail()}
    >
      ${product ? this.#detailBody(product) : nothing}
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
    const nameLocale = this.#nameLocale();
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
                    html`<th scope="col" class="col-head">${allergenName(code, nameLocale)}</th>`,
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
