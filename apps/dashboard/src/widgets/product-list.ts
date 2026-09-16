import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import { t } from "../i18n/t.js";
import { allergenState, allergenStateName, vatClassName } from "../i18n/domain.js";
import type { Product } from "../api/client.js";

/** Presents reusable products and emits the selected product id; menus own selling prices. */
@customElement("dashboard-product-list")
export class ProductList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* Every rule here crosses one shadow boundary on purpose. The cell markup below is built in
         this file but handed to <wt-data-table> as a callback, so the nodes are parented in THAT
         element's shadow root; a class selector in this stylesheet cannot reach them, and the cell
         would render unstyled while every attribute assertion still passed. A part= attribute on the
         markup plus ::part() here is what crosses it — the pattern categories-screen.ts uses. */
      wt-data-table::part(product-cell) {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
      }
      wt-data-table::part(thumb-frame),
      wt-data-table::part(thumb-placeholder) {
        flex: none;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow: hidden;
        background: var(--wt-color-surface);
      }
      wt-data-table::part(thumbnail) {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      wt-data-table::part(badge) {
        display: inline-flex;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
    `,
  ];

  @property({ attribute: false }) products: Product[] = [];

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

  #columns(): DataTableColumn<Product>[] {
    const editLabel = t("action.edit");
    return [
      {
        key: "name",
        label: t("product.description"),
        sortValue: (product) => product.name,
        cell: (product) =>
          html`<span part="product-cell">
            ${
              product.image === null
                ? html`<span
                    part="thumb-placeholder"
                    data-test="thumb-placeholder"
                    aria-hidden="true"
                  ></span>`
                : html`<span part="thumb-frame" data-test="thumb"
                    ><img part="thumbnail" src=${`/media/${product.image}`} alt=""
                  /></span>`
            }
            <strong>${product.name}</strong>
          </span>`,
      },
      {
        key: "vat",
        label: t("product.vat"),
        cell: (product) => vatClassName(product.vatClass),
        sortValue: (product) => vatClassName(product.vatClass),
      },
      {
        key: "active",
        label: t("product.active"),
        cell: (product) =>
          html`<span
            part="badge"
            data-test="active-badge"
            data-active=${product.active ? "true" : "false"}
            >${product.active ? t("product.active_badge") : t("product.inactive_badge")}</span
          >`,
        sortValue: (product) => (product.active ? 0 : 1),
      },
      {
        key: "allergens",
        label: t("product.allergens"),
        cell: (product) => {
          const state = allergenState(product.allergens);
          return html`<span part="badge" data-test="allergen-state" data-state=${state}
            >${allergenStateName(state)}</span
          >`;
        },
        sortValue: (product) => allergenStateName(allergenState(product.allergens)),
      },
      {
        key: "actions",
        label: t("staff.actions"),
        align: "end",
        cell: (product) =>
          html`<wt-button
            variant="ghost"
            data-test=${`edit-${product.id}`}
            aria-label=${`${editLabel} ${product.name}`}
            @click=${(event: Event) => this.#edit(event, product.id)}
            >${editLabel}</wt-button
          >`,
      },
    ];
  }

  override render() {
    return html`<wt-data-table
      aria-label=${t("catalogue.title")}
      .rows=${this.products}
      .columns=${this.#columns()}
      .rowKey=${(product: Product) => product.id}
      .emptyMessage=${t("catalogue.no_products")}
    ></wt-data-table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-list": ProductList;
  }
}
