import { AppError } from "@waitron/shared";
import { firstNewClash } from "./name-uniqueness.js";
import { storeProductNameKeys } from "./product-names.js";
import "./errors.js";

type Rows = readonly Record<string, unknown>[];

function isActive(value: unknown): boolean {
  return value === true || value === 1;
}

/** The first name two of `names` share, ignoring case and surrounding spaces. An import replaces
 * every stored category and product, so each imported row counts as changed. */
function sharedName(names: readonly unknown[]): string | undefined {
  return firstNewClash(
    names.filter((name) => typeof name === "string").map((name) => ({ name, changed: true })),
  )?.name.trim();
}

/**
 * Refuses a bundle holding two categories with one parent, or two Active products or variants,
 * that share a name: the rules `assertCategoryNamesFree` and `assertFamilyNamesFree` hold on a save.
 * A category with no `category_details` row is top-level, as it is to the save's check.
 */
export function validateCatalogueConfiguration(tables: Readonly<Record<string, Rows>>): void {
  const parentOf = new Map(
    (tables.category_details ?? []).map((row) => [row.category_id, row.parent_id ?? null]),
  );
  const byParent = new Map<unknown, unknown[]>();
  for (const category of tables.categories ?? []) {
    const parent = parentOf.get(category.id) ?? null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), category.name]);
  }
  for (const names of byParent.values()) {
    const name = sharedName(names);
    if (name !== undefined) throw new AppError("category.name_taken", { field: "name", name });
  }

  const products = tables.products ?? [];
  const activeIds = new Set(products.filter((row) => isActive(row.active)).map((row) => row.id));
  const counted = products.filter(
    (row) =>
      isActive(row.active) &&
      (row.parent_id === null || row.parent_id === undefined || activeIds.has(row.parent_id)),
  );
  const name = sharedName(counted.map((row) => row.name));
  if (name !== undefined) throw new AppError("product.name_taken", { field: "name", name });
}

export const CATALOGUE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "category_details" },
    { name: "content_languages" },
    { name: "unit_seed_states" },
    { name: "units" },
    { name: "product_units" },
    { name: "menu_items" },
    { name: "menu_item_variant_overrides" },
    { name: "option_lists", references: ["default_label_id"] },
    { name: "option_labels" },
    { name: "extra_lists" },
    { name: "extra_list_items" },
    { name: "product_modifiers" },
    { name: "sections" },
    { name: "section_members" },
    { name: "menu_details" },
    { name: "device_profile_home_layouts", references: ["layout_id"] },
  ],
  validate: validateCatalogueConfiguration,
  afterImport: storeProductNameKeys,
} as const;
