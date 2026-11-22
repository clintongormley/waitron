import {
  AppError,
  type ContentLanguages,
  stringToBasisPoints,
  colorOrNull,
  HOME_DEVICES,
  MAX_SET_MENU_AMOUNT_CENTS,
  homeDisplayProblem,
  isCalendarDate,
} from "@waitron/shared";
import { resolveInstalledContentLanguageRules } from "@waitron/country-packs";
import { menus, readTaxpayer, readVenue, type Transaction } from "@waitron/db";
import { checkedContentLanguages } from "./content-languages.js";
import { checkSectionMemberRows } from "./include-folder.js";
import { syncMenuOffers } from "./menu-structure.js";
import { vatRatesOfArea } from "./takeaway-vat-rates.js";
import { firstNewClash } from "./name-uniqueness.js";
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
        throw new AppError("setup.request_invalid", { field: `menus.${device}_${field}` });
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

/** Every menu owns exactly one root and one Home section from its creation (`createMenuShell`), and
 * readers and the import's offer sync find a menu through its root. */
function checkMenuShells(tables: Readonly<Record<string, Rows>>): void {
  const owned = new Map<unknown, { menu_root: number; home_layout: number }>(
    (tables.menus ?? []).map((row) => [row.id, { menu_root: 0, home_layout: 0 }]),
  );
  for (const row of tables.sections ?? []) {
    const counts = owned.get(row.owner_menu_id);
    if (counts !== undefined && (row.role === "menu_root" || row.role === "home_layout"))
      counts[row.role] += 1;
  }
  for (const counts of owned.values())
    if (counts.menu_root !== 1 || counts.home_layout !== 1)
      throw new AppError("setup.request_invalid", { field: "sections.owner_menu_id" });
}

/** Every top-level product has one takeaway rate from the beginning; a variant may have none and
 * takes its parent's, but one with rows of its own has one from the beginning, since its own rows
 * replace its parent's. No product has two rates from one day, and every day is a calendar date. */
function checkTakeawayVatRates(tables: Readonly<Record<string, Rows>>): void {
  const rates = tables.product_takeaway_vat_rates;
  if (rates === undefined) return;
  const refuse = (column: string) => {
    throw new AppError("setup.request_invalid", {
      field: `product_takeaway_vat_rates.${column}`,
    });
  };
  const productIds = new Set((tables.products ?? []).map((row) => row.id));
  const days = new Set<string>();
  const withRows = new Set<unknown>();
  const withFirstRow = new Set<unknown>();
  for (const row of rates) {
    if (!productIds.has(row.product_id)) refuse("product_id");
    const startsOn = row.starts_on ?? null;
    if (startsOn !== null && (typeof startsOn !== "string" || !isCalendarDate(startsOn)))
      refuse("starts_on");
    const day = JSON.stringify([row.product_id, startsOn]);
    if (days.has(day)) refuse("starts_on");
    days.add(day);
    withRows.add(row.product_id);
    if (startsOn === null) withFirstRow.add(row.product_id);
  }
  for (const row of tables.products ?? [])
    if ((row.parent_id == null || withRows.has(row.id)) && !withFirstRow.has(row.id))
      refuse("product_id");
}

/** A takeaway rate the importing venue's area does not offer for picking is refused, as a save
 * refuses it. The area is looked up only when there are rows to check. */
function checkPickableTakeawayVatRates(
  rows: Rows | undefined,
  country: string,
  territory: string,
): void {
  if (rows === undefined || rows.length === 0) return;
  const pickable = new Set(vatRatesOfArea(country, territory).pickable.map(stringToBasisPoints));
  for (const row of rows)
    if (!pickable.has(row.rate as number))
      throw new AppError("setup.request_invalid", { field: "product_takeaway_vat_rates.rate" });
}

function isSetMenuAmount(cents: unknown): boolean {
  return (
    typeof cents === "number" &&
    Number.isInteger(cents) &&
    cents >= 0 &&
    cents <= MAX_SET_MENU_AMOUNT_CENTS
  );
}

function checkSetMenus(tables: Readonly<Record<string, Rows>>): void {
  const setMenus = (tables.menus ?? []).filter((row) => row.kind === "set_menu");
  for (const row of setMenus)
    if (!isSetMenuAmount(row.set_price))
      throw new AppError("setup.request_invalid", { field: "menus.set_price" });

  const setMenuIds = new Set(setMenus.map((row) => row.id));
  for (const row of tables.set_menu_lines ?? [])
    if (!setMenuIds.has(row.menu_id))
      throw new AppError("setup.request_invalid", { field: "set_menu_lines.menu_id" });

  const setMenuItems = (tables.menu_items ?? []).filter((row) => setMenuIds.has(row.menu_id));
  const setMenuItemIds = new Set(setMenuItems.map((row) => row.id));
  for (const row of setMenuItems)
    if (row.gross_price != null && !isSetMenuAmount(row.gross_price))
      throw new AppError("setup.request_invalid", { field: "menu_items.gross_price" });
  for (const row of tables.menu_item_variant_overrides ?? [])
    if (setMenuItemIds.has(row.menu_item_id) && !isSetMenuAmount(row.price))
      throw new AppError("setup.request_invalid", { field: "menu_item_variant_overrides.price" });
  for (const table of ["set_menu_dish_courses", "set_menu_variant_exclusions"] as const)
    for (const row of tables[table] ?? [])
      if (!setMenuItemIds.has(row.menu_item_id))
        throw new AppError("setup.request_invalid", { field: `${table}.menu_item_id` });
}

/** The first name two of `names` share, ignoring case and surrounding spaces. An import replaces
 * every stored category and product, so each imported row counts as changed. */
function sharedName(names: readonly string[]): string | undefined {
  return firstNewClash(names.map((name) => ({ name, changed: true })))?.name.trim();
}

function checkContentLanguages(
  input: unknown,
  geography?: { readonly country: string; readonly area: string | null },
): void {
  if (geography === undefined || typeof geography.country !== "string")
    throw new AppError("setup.request_invalid", { field: "venue" });
  const { required } = resolveInstalledContentLanguageRules(geography);
  if (input === null) {
    if (required[0] !== undefined)
      throw new AppError("content.language_required", { language: required[0] });
    return;
  }
  let config: ContentLanguages;
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error();
    const row = input as Record<string, unknown>;
    if (
      typeof row.defaultLanguage !== "string" ||
      !Array.isArray(row.languages) ||
      row.languages.some((language) => typeof language !== "string")
    )
      throw new Error();
    config = checkedContentLanguages({
      defaultLanguage: row.defaultLanguage,
      languages: row.languages,
    });
    if (
      config.defaultLanguage !== row.defaultLanguage ||
      row.languages.some((language) => !config.languages.includes(language))
    )
      throw new Error();
  } catch {
    throw new AppError("content.languages_invalid", {});
  }
  checkedContentLanguages(config, required);
}

export function validateMenuConfiguration(
  tables: Readonly<Record<string, Rows>>,
  bundle?: {
    readonly country: string;
    readonly area: string | null;
    readonly contentLanguages: unknown;
  },
): void {
  if (bundle !== undefined) checkContentLanguages(bundle.contentLanguages, bundle);
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
  for (const table of ["option_lists", "option_labels", "extra_lists"] as const)
    for (const row of tables[table] ?? [])
      if (nameOf(row, table).trim() === "")
        throw new AppError("setup.request_invalid", { field: `${table}.name` });
  for (const row of tables.extra_lists ?? [])
    if (row.max_picks != null && (typeof row.max_picks !== "number" || row.max_picks < 1))
      throw new AppError("setup.request_invalid", { field: "extra_lists.max_picks" });
  const defaults = new Set<unknown>();
  for (const row of tables.option_labels ?? []) {
    if (row.is_default !== undefined && row.is_default !== 0 && row.is_default !== 1)
      throw new AppError("setup.request_invalid", { field: "option_labels.is_default" });
    if (row.is_default !== 1) continue;
    if (defaults.has(row.list_id))
      throw new AppError("setup.request_invalid", { field: "option_labels.is_default" });
    defaults.add(row.list_id);
  }
  checkHomeDisplays(tables.menus);
  checkSetMenus(tables);
  checkColors(tables.products, "products");
  checkTakeawayVatRates(tables);
  for (const row of tables.products ?? [])
    if (row.parent_id != null)
      for (const column of ["category_id", "color"])
        if (row[column] != null)
          throw new AppError("setup.request_invalid", { field: `products.${column}` });
  checkColors(tables.categories, "categories");
  checkColors(tables.sections, "sections");
  checkSectionMemberRows(tables.section_members, tables.sections, tables.menus);
  checkMenuShells(tables);
  const parentOf = new Map((tables.categories ?? []).map((row) => [row.id, row.parent_id ?? null]));
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

export const MENU_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "units" },
    { name: "menu_items" },
    { name: "menu_item_variant_overrides" },
    { name: "set_menu_lines" },
    { name: "set_menu_line_courses" },
    { name: "set_menu_variant_exclusions" },
    { name: "set_menu_dish_courses" },
    { name: "option_lists" },
    { name: "option_labels" },
    { name: "extra_lists" },
    { name: "extra_list_items" },
    { name: "product_modifiers" },
    { name: "sections" },
    { name: "section_members" },
  ],
  validate: validateMenuConfiguration,
  async beforeImport(
    tx: Transaction,
    tables: Readonly<Record<string, Rows>>,
    bundle?: { readonly contentLanguages: unknown },
  ): Promise<void> {
    const country = (await readTaxpayer(tx))?.country;
    if (country === undefined) throw new AppError("setup.request_invalid", { field: "venue" });
    const venue = await readVenue(tx);
    checkContentLanguages(bundle?.contentLanguages ?? null, { country, area: venue.province });
    checkPickableTakeawayVatRates(
      tables.product_takeaway_vat_rates,
      country,
      venue.fiscalTerritory,
    );
  },
  async afterImport(tx: Transaction): Promise<void> {
    const rows = await tx.select({ id: menus.id }).from(menus);
    await syncMenuOffers(
      tx,
      rows.map((row) => row.id),
    );
  },
} as const;
