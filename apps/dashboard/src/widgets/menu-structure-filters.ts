import { nothing } from "lit";
import type { DataTableColumn } from "@waitron/ui";
import { clashesOf } from "@waitron/menu/src/menu-combine.js";
import type { Product } from "../api/client.js";
import type { CategorySummary } from "../api/catalog-api.js";
import type { MenuStructureNode } from "../api/menu-api.js";
import { t } from "../i18n/t.js";
import type { StructurePricing } from "./menu-structure-price-cell.js";

type MemberRow = {
  kind: "member";
  node: MenuStructureNode;
  variant?: Product["variants"][number];
};
type FilterRow = { kind: "root" } | MemberRow;

export function structurePriceFilter<TableRow extends FilterRow>(
  pricing?: StructurePricing,
): NonNullable<DataTableColumn<TableRow>["filter"]> {
  return {
    label: t("set_menus.price"),
    allLabel: t("menu_prices.all_prices"),
    value: (row) => {
      if (row.kind === "root" || row.node.ref.kind !== "product" || !pricing) return [];
      const id = row.node.ref.productId;
      const offer = pricing.offers.get(id);
      if (!offer) return [];
      const variantId = row.variant?.id;
      const own =
        variantId === undefined && offer.variants.length
          ? offer.variants.some((variant) => pricing.draft.price(id, variant.variantId) !== "")
          : pricing.draft.price(id, variantId) !== "";
      const clash = clashesOf(offer).some((clash) => !variantId || clash.variantId === variantId);
      return [...(own ? ["own"] : []), ...(clash ? ["clashes"] : [])];
    },
    options: [
      { value: "own", label: t("menus.price_set_here") },
      { value: "clashes", label: t("menu_prices.clashes_only") },
    ],
  };
}

export function structureFilters<TableRow extends FilterRow>(
  products: ReadonlyMap<string, Product>,
  categories: readonly CategorySummary[],
): DataTableColumn<TableRow>[] {
  const productFor = (row: TableRow) =>
    row.kind === "member" && row.node.ref.kind === "product"
      ? products.get(row.node.ref.productId)
      : undefined;
  const check = (
    key: string,
    label: string,
    matches: (row: MemberRow, product: Product) => boolean,
    yes: string,
    no: string,
  ): DataTableColumn<TableRow> => ({
    key,
    label,
    cell: () => nothing,
    filter: {
      label,
      allLabel: t("product.filter_any"),
      value: (row) => {
        const product = productFor(row);
        if (row.kind !== "member" || !product) return [];
        return matches(row, product) ? "yes" : "no";
      },
      options: [
        { value: "yes", label: yes },
        { value: "no", label: no },
      ],
    },
  });
  return [
    check(
      "available",
      t("editor.available"),
      (row, product) => (row.variant ?? product).available,
      t("menus.available_yes"),
      t("menus.available_no"),
    ),
    {
      key: "category",
      label: t("menu_prices.category_filter"),
      cell: () => nothing,
      filter: {
        label: t("menu_prices.category_filter"),
        allLabel: t("menu_prices.all_categories"),
        value: (row) => productFor(row)?.categoryId ?? [],
        options: categories.map(({ id, name }) => ({ value: id, label: name })),
      },
    },
    check(
      "modifiers",
      t("editor.modifiers"),
      (_row, product) => product.modifiers?.length > 0,
      t("product.has_modifiers"),
      t("product.no_modifiers"),
    ),
    check(
      "variants",
      t("editor.variants"),
      (_row, product) => product.variants.some(({ active }) => active !== false),
      t("product.has_variants"),
      t("product.no_variants"),
    ),
  ];
}
