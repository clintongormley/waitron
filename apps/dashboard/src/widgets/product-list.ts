import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, currentContentLanguages, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { t, currentLocale } from "../i18n/t.js";
import { allergenState, allergenStateName, vatClassName } from "../i18n/domain.js";
import { categoryPath } from "./category-form.js";
import {
  modifierListName,
  modifierListNames,
  type ModifierListChoice,
} from "./product-editor-model.js";
import type { CategorySummary, Product } from "../api/client.js";

interface ProductRow {
  key: string;
  parentKey: string | null;
  product: Product;
  variant: Product["variants"][number] | null;
}

/** The till sells a variant only while it AND its product are Active, so that is its status. */
function rowActive({ product, variant }: ProductRow): boolean {
  return product.active && (variant?.active ?? true);
}

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
      wt-data-table::part(variant-muted),
      wt-data-table::part(context) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(vat-note) {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }
    `,
  ];

  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];

  #listNames: ReadonlyMap<string, string> = new Map();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
  }

  #emit(
    event: Event,
    name: "edit-product" | "delete-product" | "restore-product",
    productId: string,
  ): void {
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
      : t("editor.missing_choice");
  }

  /** A variant's row reads the values it is reported under, which the server resolves. */
  #values({ product, variant }: ProductRow): {
    primaryCategoryId: string | null;
    categoryIds: string[];
  } {
    return variant?.effective ?? product;
  }

  #otherCategories(row: ProductRow): string {
    const { categoryIds, primaryCategoryId } = this.#values(row);
    return categoryIds
      .filter((id) => id !== primaryCategoryId)
      .map((id) => this.#category(id))
      .filter(Boolean)
      .join(", ");
  }

  #modifierNames(product: Product): string {
    return product.modifiers.map((ref) => modifierListName(ref, this.#listNames)).join(", ");
  }

  #unavailableBadge() {
    return html`<span part="badge" data-test="unavailable-badge"
      >${t("product.unavailable_badge")}</span
    >`;
  }

  /** A product with an Active variant is sold only as one of them, and one with none sells as
   * itself. */
  #price({ product, variant }: ProductRow): string {
    if (variant) return Number(variant.effective.unitPrice).toFixed(2);
    const sold = product.variants.filter(({ active }) => active);
    if (sold.length === 0) return Number(product.unitPrice).toFixed(2);
    const prices = sold.map(({ effective }) => Number(effective.unitPrice));
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
        cell: ({ product, variant }, { ancestorOnly }) =>
          variant
            ? html`<strong>${variant.name}</strong>`
            : html`<span part=${ancestorOnly ? "product-cell context" : "product-cell"}>
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
        cell: (row) => this.#category(this.#values(row).primaryCategoryId),
        searchValue: (row) => this.#category(this.#values(row).primaryCategoryId),
      },
      {
        key: "other-categories",
        label: t("product.other_categories"),
        cell: (row) => this.#otherCategories(row),
        searchValue: (row) => this.#otherCategories(row),
      },
      {
        key: "price",
        label: t("product.price"),
        align: "end",
        // The list has no VAT column; a variant whose VAT differs from its product's notes it under
        // its price, since nothing else on the row would show it.
        cell: (row) => {
          const vat = row.variant?.effective.vatClass;
          return html`<span data-test="price">${this.#price(row)}</span>${
              vat === undefined || vat === row.product.vatClass
                ? nothing
                : html`<span part="vat-note" data-test="vat-note"
                    >${t("product.vat")}: ${vatClassName(vat)}</span
                  >`
            }`;
        },
        sortValue: (row) => Number(this.#price(row).split("–")[0]),
      },
      {
        key: "modifiers",
        label: t("editor.modifiers"),
        cell: ({ product, variant }) =>
          variant ? html`<span part="variant-muted">—</span>` : this.#modifierNames(product),
        searchValue: ({ product, variant }) => (variant ? "" : this.#modifierNames(product)),
      },
      {
        key: "sold-alone",
        label: t("product.sold_alone"),
        // A variant is a way of buying its product, so the filter reads the PRODUCT's answer on
        // every row and a variant is shown or hidden together with its product.
        cell: ({ product, variant }) => {
          if (variant) return html`<span part="variant-muted">—</span>`;
          return html`<span
            part="badge"
            data-test="sold-alone-badge"
            data-sold-alone=${product.soldAlone ? "true" : "false"}
            >${
              product.soldAlone ? t("product.sold_alone_badge") : t("product.not_sold_alone_badge")
            }</span
          >`;
        },
        searchValue: ({ product, variant }) =>
          variant
            ? ""
            : product.soldAlone
              ? t("product.sold_alone_badge")
              : t("product.not_sold_alone_badge"),
        sortValue: ({ product }) => (product.soldAlone ? 0 : 1),
        filter: {
          label: t("product.sold_alone"),
          allLabel: t("product.filter_sold_alone_all"),
          value: ({ product }) => (product.soldAlone ? "true" : "false"),
          options: [
            { value: "true", label: t("product.sold_alone_badge") },
            { value: "false", label: t("product.not_sold_alone_badge") },
          ],
        },
      },
      {
        key: "active",
        label: t("product.status"),
        // A variant of an Inactive product answers Inactive (see rowActive), so it moves with its
        // product and never leaves it behind as an empty context row; its badge still shows its OWN
        // flag.
        cell: ({ product, variant }) => {
          const active = variant?.active ?? product.active;
          return html`<span
              part="badge"
              data-test="active-badge"
              data-active=${active ? "true" : "false"}
              >${active ? t("product.active_badge") : t("product.inactive_badge")}</span
            >
            ${(variant ?? product).available ? nothing : this.#unavailableBadge()}`;
        },
        sortValue: (row) => (rowActive(row) ? 0 : 1),
        filter: {
          label: t("product.status"),
          allLabel: t("product.filter_status_all"),
          value: (row) => (rowActive(row) ? "active" : "inactive"),
          options: [
            { value: "active", label: t("product.active_badge") },
            { value: "inactive", label: t("product.inactive_badge") },
          ],
          initial: "active",
        },
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
        cell: ({ product, variant }) => {
          const { id, name } = variant ?? product;
          const restore = variant !== null && !variant.active;
          const removal = restore
            ? { event: "restore-product" as const, test: "restore", label: t("product.restore") }
            : {
                event: "delete-product" as const,
                test: "delete",
                label: variant ? t("action.remove") : t("action.delete"),
              };
          return html`<wt-row-actions
            align="end"
            data-test=${`actions-${id}`}
            label=${`${t("staff.actions")}: ${name}`}
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`edit-${id}`}
              @click=${(event: Event) => this.#emit(event, "edit-product", id)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant=${restore ? "secondary" : "danger"}
              data-test=${`${removal.test}-${id}`}
              @click=${(event: Event) => this.#emit(event, removal.event, id)}
              >${removal.label}</wt-button
            ></wt-row-actions
          >`;
        },
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
