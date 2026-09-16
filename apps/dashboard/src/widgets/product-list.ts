import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, currentContentLanguages, type DataTableColumn } from "@waitron/ui";
import { resolveContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { t, currentLocale } from "../i18n/t.js";
import { allergenState, allergenStateName } from "../i18n/domain.js";
import { categoryPath } from "./category-form.js";
import type { CategorySummary, Modifier, Product, ProductEditorVariant } from "../api/client.js";

interface ProductRow {
  key: string;
  parentKey: string | null;
  product: Product;
  variant: ProductEditorVariant | null;
}

/** Presents the reusable product library, with each product's variants nested underneath it. */
@customElement("dashboard-product-list")
export class ProductList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* Cell templates are rendered in wt-data-table's shadow root, so ::part is the one boundary
         crossing used for their presentation. */
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
      wt-data-table::part(variant-muted) {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) modifiers: Modifier[] = [];

  #emit(event: Event, name: "edit-product" | "delete-product", productId: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ productId: string }>(name, {
        detail: { productId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #rows(): ProductRow[] {
    return this.products.flatMap((product) => [
      { key: product.id, parentKey: null, product, variant: null },
      ...product.variants.map((variant) => ({
        key: `${product.id}:${variant.id}`,
        parentKey: product.id,
        product,
        variant,
      })),
    ]);
  }

  #category(id: string | null): string {
    if (id === null) return "";
    const category = this.categories.find((candidate) => candidate.id === id);
    return category
      ? categoryPath(category, this.categories, currentLocale(), currentContentLanguages())
      : "";
  }

  #otherCategories(product: Product): string {
    return product.categoryIds
      .filter((id) => id !== product.primaryCategoryId)
      .map((id) => this.#category(id))
      .filter(Boolean)
      .join(", ");
  }

  #modifierNames(product: Product): string {
    const language = currentContentLanguages().defaultLanguage;
    return product.modifierIds
      .map((id) => this.modifiers.find((modifier) => modifier.id === id))
      .map((modifier) =>
        modifier ? resolveContentText(modifier.name, currentLocale(), language) : "",
      )
      .filter(Boolean)
      .join(", ");
  }

  #price(product: Product): string {
    if (product.variants.length === 0) return product.unitPrice;
    const prices = product.variants.map(({ unitPrice }) => Number(unitPrice));
    const low = Math.min(...prices).toFixed(2);
    const high = Math.max(...prices).toFixed(2);
    return low === high ? low : `${low}–${high}`;
  }

  #columns(): DataTableColumn<ProductRow>[] {
    return [
      {
        key: "name",
        label: t("product.name"),
        sortValue: (row) => row.variant?.name ?? row.product.name,
        searchValue: (row) => row.variant?.name ?? row.product.name,
        cell: ({ product, variant }) =>
          variant
            ? html`<strong>${variant.name}</strong>`
            : html`<span part="product-cell">
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
        key: "reporting-category",
        label: t("product.reporting_category"),
        cell: ({ product, variant }) =>
          variant
            ? html`<span part="variant-muted">—</span>`
            : this.#category(product.primaryCategoryId),
        searchValue: ({ product, variant }) =>
          variant ? "" : this.#category(product.primaryCategoryId),
      },
      {
        key: "other-categories",
        label: t("product.other_categories"),
        cell: ({ product, variant }) =>
          variant ? html`<span part="variant-muted">—</span>` : this.#otherCategories(product),
        searchValue: ({ product, variant }) => (variant ? "" : this.#otherCategories(product)),
      },
      {
        key: "price",
        label: t("product.price"),
        align: "end",
        cell: ({ product, variant }) => variant?.unitPrice ?? this.#price(product),
        sortValue: ({ product, variant }) =>
          Number(variant?.unitPrice ?? this.#price(product).split("–")[0]),
      },
      {
        key: "modifiers",
        label: t("editor.modifiers"),
        cell: ({ product, variant }) =>
          variant ? html`<span part="variant-muted">—</span>` : this.#modifierNames(product),
        searchValue: ({ product, variant }) => (variant ? "" : this.#modifierNames(product)),
      },
      {
        key: "active",
        label: t("product.active"),
        cell: ({ product, variant }) => {
          const active = variant?.available ?? product.active;
          return html`<span
            part="badge"
            data-test="active-badge"
            data-active=${active ? "true" : "false"}
            >${active ? t("product.active_badge") : t("product.inactive_badge")}</span
          >`;
        },
        sortValue: ({ product, variant }) => ((variant?.available ?? product.active) ? 0 : 1),
      },
      {
        key: "allergens",
        label: t("product.allergens"),
        cell: ({ product, variant }) => {
          if (variant) return html`<span part="variant-muted">—</span>`;
          const state = allergenState(product.allergens);
          return html`<span part="badge" data-test="allergen-state" data-state=${state}
            >${allergenStateName(state)}</span
          >`;
        },
        sortValue: ({ product, variant }) =>
          variant ? "" : allergenStateName(allergenState(product.allergens)),
      },
      {
        key: "actions",
        label: t("staff.actions"),
        align: "end",
        cell: ({ product, variant }) =>
          variant
            ? nothing
            : html`<wt-row-actions
                align="end"
                data-test=${`actions-${product.id}`}
                label=${`${t("staff.actions")}: ${product.name}`}
                ><wt-button
                  align="start"
                  variant="secondary"
                  data-test=${`edit-${product.id}`}
                  @click=${(event: Event) => this.#emit(event, "edit-product", product.id)}
                  >${t("action.edit")}</wt-button
                ><wt-button
                  align="start"
                  variant="danger"
                  data-test=${`delete-${product.id}`}
                  @click=${(event: Event) => this.#emit(event, "delete-product", product.id)}
                  >${t("action.delete")}</wt-button
                ></wt-row-actions
              >`,
      },
    ];
  }

  override render() {
    return html`<wt-data-table
      aria-label=${t("catalogue.title")}
      searchable
      searchLabel=${t("product.search")}
      noMatchesMessage=${t("product.no_matches")}
      viewKey="waitron.products.table"
      sortKey="name"
      sortDirection="ascending"
      collapseLabel=${t("categories.collapse")}
      expandLabel=${t("categories.expand")}
      initiallyCollapsed
      .rows=${this.#rows()}
      .columns=${this.#columns()}
      .rowKey=${(row: ProductRow) => row.key}
      .rowParent=${(row: ProductRow) => row.parentKey}
      .emptyMessage=${t("catalogue.no_products")}
    ></wt-data-table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-list": ProductList;
  }
}
