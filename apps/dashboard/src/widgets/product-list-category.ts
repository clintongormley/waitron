import { css, html, nothing } from "lit";
import { categoryColorSource } from "@waitron/shared";
import type { DataTableColumn } from "@waitron/ui";
import type { CategorySummary, Product } from "../api/client.js";
import { t } from "../i18n/t.js";
import { categoryAncestors, PATH_SEPARATOR } from "./category-form.js";
import { categoryTree } from "./classification-fields.js";
import { swatchChip } from "./swatch-styles.js";

type ProductCategory = { product: Product; variant: Product["variants"][number] | null };

export const PRODUCTS_PHONE_WIDTH = 440;

export const productListCategoryStyles = css`
  wt-data-table[wrap-to-fit]::part(list-cell) {
    vertical-align: middle;
  }
  wt-data-table[data-list][wrap-to-fit]::part(product-cell),
  wt-data-table[data-list][wrap-to-fit]::part(variant-cell) {
    display: flex;
    align-items: center;
  }
  wt-data-table[data-list][wrap-to-fit]::part(name-stack),
  wt-data-table[data-list][wrap-to-fit]::part(variant-name) {
    min-inline-size: 0;
  }
  wt-data-table::part(category-path-cell) {
    display: inline-grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    vertical-align: middle;
    max-inline-size: calc(var(--wt-tap-min) * 4);
    gap: var(--wt-space-2);
    overflow-wrap: anywhere;
  }
  wt-data-table::part(category-path-name) {
    min-width: 0;
  }
`;

export function productCategoryColumn(
  categories: readonly CategorySummary[],
  defaultColor: string | null,
  phone: boolean,
): DataTableColumn<ProductCategory> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const paths = new Map(
    categories.map((category) => [category.id, categoryAncestors(category, categories).reverse()]),
  );
  const path = ({ product }: ProductCategory) => paths.get(product.primaryCategoryId ?? "");
  const name = (row: ProductCategory) =>
    path(row)
      ?.map((category) => category.name)
      .join(PATH_SEPARATOR);
  const options = categoryTree(categories);
  return {
    key: "category",
    label: t("product.category"),
    choosable: phone ? "hidden" : "shown",
    cell: (row) => {
      const category = path(row)?.at(-1);
      if (row.variant !== null || !category) return nothing;
      const { color } = categoryColorSource(category.id, byId, defaultColor);
      return html`<span part="category-path-cell"
        >${swatchChip(color)}<span part="category-path-name">${name(row)}</span></span
      >`;
    },
    sortValue: (row) => name(row) ?? null,
    searchValue: (row) => name(row) ?? "",
    ...(options.length && {
      filter: {
        label: t("product.category"),
        allLabel: t("product.filter_any"),
        options,
        preserveOrder: true,
        value: (row: ProductCategory) => path(row)?.map((category) => category.id) ?? [],
      },
    }),
  };
}
