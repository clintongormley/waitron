import { VAT_CLASSES, type VatClass } from "./vat-rates.js";
import { AppError, type ContentLanguages } from "@waitron/shared";
import { resolveInstalledContentLanguageRules } from "@waitron/country-packs";
import { checkedContentLanguages } from "./content-languages.js";
import { colorOrNull } from "./color-inheritance.js";
import { HOME_DEVICES, homeDisplayProblem } from "./device-home.js";
import { checkIncludeFolderRows } from "./include-folder.js";
import { firstNewClash } from "./name-uniqueness.js";
import { storeProductNameKeys } from "./product-names.js";
import { unitStaffText, validateUnitPrecision } from "./unit-validation.js";
import { validateOptionalTranslations } from "./optional-translations.js";
import "./errors.js";

type Rows = readonly Record<string, unknown>[];

/** A row's `name`, refused unless it is text, so the comparison never guesses how the engine would
 * store another value. */
function nameOf(row: Record<string, unknown>, table: string): string {
  if (typeof row.name !== "string")
    throw new AppError("setup.request_invalid", { field: `${table}.name` });
  return row.name;
}

/** Whether a product row will be stored Active. The export writes the flag as 0 or 1; a row without
 * it takes the column's default, Active. Any other value is refused rather than guessed at. */
function isActive(row: Record<string, unknown>): boolean {
  if (row.active === undefined) return true;
  if (row.active !== 0 && row.active !== 1)
    throw new AppError("setup.request_invalid", { field: "products.active" });
  return row.active === 1;
}

/** Screens paint a stored colour into a style attribute, so only the spelling a save stores may come
 * in. */
function checkColors(rows: Rows | undefined, table: string, column = "color"): void {
  for (const row of rows ?? [])
    if (row[column] !== undefined)
      colorOrNull(row[column], () => {
        throw new AppError("setup.request_invalid", { field: `${table}.${column}` });
      });
}

/** A display setting a save would refuse is refused on import too: the till draws it. */
function checkHomeDisplays(rows: Rows | undefined): void {
  for (const row of rows ?? [])
    for (const device of HOME_DEVICES) {
      const field = homeDisplayProblem(device, {
        columns: row[`${device}_columns`],
        tiles: row[`${device}_tiles`],
        order: row[`${device}_order`],
      });
      if (field !== null)
        throw new AppError("setup.request_invalid", { field: `menu_details.${device}_${field}` });
    }
}

/** An Inactive product sits in no menu list or Device Home Page shortcut, and an Inactive variant
 * holds no menu price, whichever writer made the rows. */
function checkActiveOnMenus(
  tables: Readonly<Record<string, Rows>>,
  inactiveIds: Set<unknown>,
): void {
  for (const row of tables.section_members ?? [])
    if (inactiveIds.has(row.product_id))
      throw new AppError("setup.request_invalid", { field: "section_members.product_id" });
  for (const row of tables.menu_item_variant_overrides ?? [])
    if (inactiveIds.has(row.variant_id))
      throw new AppError("setup.request_invalid", {
        field: "menu_item_variant_overrides.variant_id",
      });
}

/** The first name two of `names` share, ignoring case and surrounding spaces. An import replaces
 * every stored category and product, so each imported row counts as changed. */
function sharedName(names: readonly string[]): string | undefined {
  return firstNewClash(names.map((name) => ({ name, changed: true })))?.name.trim();
}

function checkContentLanguages(
  rows: Rows | undefined,
  geography?: { readonly country: string; readonly area: string | null },
): void {
  if (rows === undefined) return;
  if (geography === undefined) throw new AppError("setup.request_invalid", { field: "venue" });
  const { required } = resolveInstalledContentLanguageRules(geography);
  if (rows.length === 0) {
    if (required[0] !== undefined)
      throw new AppError("content.language_required", { language: required[0] });
    return;
  }
  if (rows.length !== 1) throw new AppError("content.languages_invalid", {});
  const row = rows[0]!;
  let config: ContentLanguages;
  try {
    const languages: unknown =
      typeof row.languages === "string" ? JSON.parse(row.languages) : undefined;
    if (
      typeof row.default_language !== "string" ||
      !Array.isArray(languages) ||
      languages.some((language) => typeof language !== "string")
    )
      throw new AppError("content.languages_invalid", {});
    config = checkedContentLanguages({ defaultLanguage: row.default_language, languages });
    // Imports store the raw row, so accept only the codes the normal writer stores.
    if (
      config.defaultLanguage !== row.default_language ||
      languages.some((language) => !config.languages.includes(language))
    )
      throw new AppError("content.languages_invalid", {});
  } catch {
    throw new AppError("content.languages_invalid", {});
  }
  checkedContentLanguages(config, required);
}

export function validateCatalogueConfiguration(
  tables: Readonly<Record<string, Rows>>,
  geography?: { readonly country: string; readonly area: string | null },
): void {
  checkContentLanguages(tables.content_languages, geography);
  for (const row of tables.units ?? []) {
    for (const [column, field] of [
      ["staff_name", "staffName"],
      ["staff_abbreviation", "staffAbbreviation"],
    ] as const) {
      try {
        unitStaffText(row[column], field);
      } catch {
        throw new AppError("setup.request_invalid", { field: `units.${column}` });
      }
    }
    for (const field of ["name", "abbreviation"] as const) {
      try {
        validateOptionalTranslations(
          typeof row[field] === "string" ? JSON.parse(row[field]) : row[field],
        );
      } catch {
        throw new AppError("setup.request_invalid", { field: `units.${field}` });
      }
    }
    try {
      validateUnitPrecision(row.precision as number);
    } catch {
      throw new AppError("setup.request_invalid", { field: "units.precision" });
    }
  }
  for (const row of tables.catalogue_settings ?? []) {
    const value = row.default_product_vat_class;
    if (typeof value !== "string" || !VAT_CLASSES.includes(value as VatClass))
      throw new AppError("setup.request_invalid", {
        field: "catalogue_settings.default_product_vat_class",
      });
  }
  checkColors(tables.catalogue_settings, "catalogue_settings", "default_color");
  checkHomeDisplays(tables.menu_details);
  checkColors(tables.products, "products");
  checkColors(tables.category_details, "category_details");
  checkColors(tables.sections, "sections");
  checkIncludeFolderRows(tables.section_members, tables.sections);
  const parentOf = new Map(
    (tables.category_details ?? []).map((row) => [row.category_id, row.parent_id ?? null]),
  );
  const byParent = new Map<unknown, string[]>();
  for (const category of tables.categories ?? []) {
    const parent = parentOf.get(category.id) ?? null;
    const name = nameOf(category, "categories");
    const names = byParent.get(parent);
    if (names === undefined) byParent.set(parent, [name]);
    else names.push(name);
  }
  for (const names of byParent.values()) {
    const name = sharedName(names);
    if (name !== undefined) throw new AppError("category.name_taken", { field: "name", name });
  }

  const products = (tables.products ?? []).map((row) => ({
    name: nameOf(row, "products"),
    active: isActive(row),
    id: row.id,
    parentId: row.parent_id,
  }));
  const activeIds = new Set(products.filter((row) => row.active).map((row) => row.id));
  checkActiveOnMenus(tables, new Set(products.filter((row) => !row.active).map((row) => row.id)));
  const counted = products.filter(
    (row) =>
      row.active &&
      (row.parentId === null || row.parentId === undefined || activeIds.has(row.parentId)),
  );
  const productScopes = new Map<unknown, string[]>();
  for (const row of counted) {
    const parent = row.parentId ?? null;
    const names = productScopes.get(parent);
    if (names === undefined) productScopes.set(parent, [row.name]);
    else names.push(row.name);
  }
  for (const names of productScopes.values()) {
    const name = sharedName(names);
    if (name !== undefined) throw new AppError("product.name_taken", { field: "name", name });
  }
}

export const CATALOGUE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "category_details" },
    { name: "content_languages" },
    { name: "catalogue_settings" },
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
  ],
  validate: validateCatalogueConfiguration,
  afterImport: storeProductNameKeys,
} as const;
