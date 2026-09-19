import { readMenuModifiers, readProductModifiers } from "./modifier-projection.js";
import type { Modifier } from "@waitron/shared";
import { lockModifierDefinitions } from "./modifier-lock.js";
import { isModifierPrice } from "./modifier-limits.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError, resolveContentText, FALLBACK_LOCALE } from "@waitron/shared";
import {
  catalogues,
  categories,
  locationCatalogues,
  locations,
  optionGroupItems,
  optionGroups,
  productOptionGroups,
  products,
} from "@waitron/db";
import { productCategories } from "./schema/categories.js";
import { readContentLanguages } from "./content-languages.js";
import { replaceProductCategories, readProductCategories, lockCategories } from "./categories.js";
export { createCategory, listCategories, updateCategory } from "./categories.js";
export type { Category } from "./categories.js";
import type { Transaction } from "@waitron/db";
import "./errors.js"; // load the code registry for `options.group_invalid`/`options.item_invalid` thrown below
import { validateAllergens, type ProductAllergens } from "./allergens.js";
import { republish, type RecipeDerivation } from "./derivation.js";
import {
  deriveDietProfile,
  overlayDietProfile,
  validateDietOverride,
  type DietDerivation,
  type DietOverride,
  type DietProfile,
} from "./dietary.js";
import type { PricingUnit, VatClass } from "./pricing.js";
import {
  contentLanguages,
  menuItemOptionGroups,
  menuItemOptions,
  menuItems,
  menuSections,
} from "./schema/menu.js";
import { productUnits, units } from "./schema/units.js";
import { menuItemVariants, productVariants } from "./schema/variants.js";
import type { ProductVariant } from "./variants.js";
import {
  assignProductUnit,
  clearProductUnit,
  EACH_UNIT,
  getSeededUnit,
  getSellableUnit,
  type SellableUnit,
} from "./units.js";
import { validateDietaryDeclarations, type DietaryLabel } from "./dietary-declarations.js";
import type { Product } from "./product-types.js";
import type {
  AccessibleCatalogue,
  AvailableProduct,
  MenuItem,
  MenuOffer,
  MenuOfferOptionGroup,
  ResolvedOptionGroup,
} from "./menu-types.js";
export type {
  AccessibleCatalogue,
  AvailableProduct,
  MenuItem,
  MenuOffer,
  MenuOfferOption,
  MenuOfferOptionGroup,
  ResolvedOptionGroup,
  ResolvedOptionItem,
} from "./menu-types.js";
export type { Product } from "./product-types.js";

/**
 * Catalogue operations — CRUD over `catalogues`/`categories`/`products`, catalogue↔location
 * assignment, and the read the till sells from (`listAvailableProducts`).
 *
 * Every operation shares the caller's transaction.
 *
 * Deactivation is `active = false`, never DELETE: a product may sit behind historical sale-line
 * snapshots, and the app role holds no DELETE grant (`products: "SIU"` in
 * `packages/fiscal-verifactu/src/privileges.expected.ts`).
 * All SQL is built with Drizzle query builders — no string concatenation.
 */

export interface Catalogue {
  id: string;
  name: string;
  active: boolean;
  /** The sync seam. Created at 1; nothing in the tree bumps it today. */
  version: number;
}

export interface MenuSection {
  id: string;
  menuId: string;
  name: Record<string, string>;
  displayOrder: number;
  active: boolean;
}

export interface CreateProductInput {
  catalogueId: string;
  categoryId: string | null;
  name: string;
  /** Customer-facing translated name; omitted or null falls back to `name`. */
  customerName?: Record<string, string> | null;
  /** The product's sellable unit. `null` = Each (no `product_units` row stored); a real id assigns
   * that unit; omitted falls back to the legacy `pricingUnit` compat path. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  /** Omitted leaves it null (unreviewed); validated against the EU-14 taxonomy on insert. */
  allergens?: ProductAllergens;
  /** The staff diet override (forced vegan/vegetarian/halal/kosher + hand contains-tags). Omitted or
   * `null` leaves it null (no override); checked disjoint before the write (CLAUDE.md §3). At create
   * there is no recipe, so published `diet` = the override overlaid on the empty derived profile. */
  dietOverride?: DietOverride | null;
  /** A stored photo reference (`<sha256>.<ext>`); omitted leaves it null (no picture). */
  image?: string;
  /** Omitted leaves it active, mirroring the `products.active` column default. Set `false` to create
   * a product that is not yet sellable at the till — atomic in the one insert, no follow-up patch. */
  active?: boolean;
  /** Omitted leaves it offered standalone, mirroring the `products.sold_alone` column default. */
  soldAlone?: boolean;
  description?: Record<string, string> | null;
  kitchenName?: string | null;
  dietaryDeclarations?: DietaryLabel[];
}

/** The mutable slice of a product. Absent keys are left unchanged (the object literal a caller
 * passes carries only the columns it means to touch); `updatedAt` is always bumped. */
export interface UpdateProductInput {
  name?: string;
  customerName?: Record<string, string> | null;
  unitPrice?: string;
  vatClass?: VatClass;
  /** `null` clears the unit (the product then reads as Each); a real id sets it; omitted leaves the
   * unit unchanged unless the legacy `pricingUnit` compat field is supplied instead. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  categoryId?: string | null;
  /** `null` clears the declaration back to unreviewed; omitted leaves it unchanged. */
  allergens?: ProductAllergens | null;
  /** Patch the staff diet override. `null` clears it (published `diet` reverts to the recipe-derived
   * profile); omitted leaves it unchanged. Checked disjoint before the write, then republished. */
  dietOverride?: DietOverride | null;
  /** `null` clears the photo reference; omitted leaves it unchanged. */
  image?: string | null;
  /** Toggle active/inactive through the edit route; omitted leaves it unchanged. */
  active?: boolean;
  /** Toggle whether the product is offered standalone; omitted leaves it unchanged. */
  soldAlone?: boolean;
  description?: Record<string, string> | null;
  kitchenName?: string | null;
  dietaryDeclarations?: DietaryLabel[];
}

const CATALOGUE_COLUMNS = {
  id: catalogues.id,
  name: catalogues.name,
  active: catalogues.active,
  version: catalogues.version,
};

const PRODUCT_BASE_COLUMNS = {
  id: products.id,
  catalogueId: products.catalogueId,
  categoryId: products.categoryId,
  name: products.name,
  customerName: products.customerName,
  soldAlone: products.soldAlone,
  pricingUnit: products.pricingUnit,
  unitPrice: products.unitPrice,
  vatClass: products.vatClass,
  active: products.active,
  allergens: products.allergens,
  manualAllergens: products.manualAllergens,
  dietOverride: products.dietOverride,
  image: products.image,
  description: products.description,
  kitchenName: products.kitchenName,
  dietaryDeclarations: products.dietaryDeclarations,
};

const PRODUCT_COLUMNS = {
  ...PRODUCT_BASE_COLUMNS,
  unitId: units.id,
  unitName: units.name,
  unitAbbreviation: units.abbreviation,
  unitPrecision: units.precision,
  hardwareUnit: units.hardwareUnit,
};

/** The joined product row as Drizzle types it back. */
interface RawProduct {
  id: string;
  catalogueId: string;
  categoryId: string | null;
  name: string;
  customerName: Record<string, string> | null;
  soldAlone: boolean;
  unitId: string | null;
  unitName: Record<string, string> | null;
  unitAbbreviation: Record<string, string> | null;
  unitPrecision: number | null;
  hardwareUnit: string | null;
  description: Record<string, string> | null;
  kitchenName: string | null;
  dietaryDeclarations: string[];
  pricingUnit: string;
  unitPrice: string;
  vatClass: string;
  active: boolean;
  allergens: ProductAllergens | null;
  manualAllergens: ProductAllergens | null;
  // The `diet_override` jsonb column's `$type` is looser than {@link DietOverride} (its contains lists
  // are `string[]`, not the `ContainsTag[]` the leaf narrows to), so `toProduct` re-attaches the narrow
  // type the DB's write-side `validateDietOverride` already guarantees — the same cast the till read
  // (`listAvailableProducts`) makes.
  dietOverride: {
    vegan?: "yes" | "no";
    vegetarian?: "yes" | "no";
    halal?: "yes" | "no";
    kosher?: "yes" | "no";
    addContains?: string[];
    removeContains?: string[];
  } | null;
  image: string | null;
}

// `pricing_unit`/`vat_class` are constrained to their unions by a CHECK (catalogue.ts), so the value
// read back is always a `PricingUnit`/`VatClass`; the cast re-attaches the type the column's runtime
// CHECK already guarantees.
function toProduct(
  row: RawProduct,
  categoryIds: string[],
  variants: ProductVariant[] = [],
): Product {
  const { unitName, unitAbbreviation, unitPrecision, hardwareUnit, ...product } = row;
  const unit = sellableUnit(row.unitId, unitName, unitPrecision, hardwareUnit, unitAbbreviation);
  return {
    ...product,
    categoryIds,
    primaryCategoryId: row.categoryId,
    modifierIds: [],
    unit,
    unitId: unit.id,
    pricingUnit: row.pricingUnit as PricingUnit,
    vatClass: row.vatClass as VatClass,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
    dietOverride: row.dietOverride as DietOverride | null,
    variants,
  };
}

function sellableUnit(
  id: string | null,
  name: Record<string, string> | null,
  precision: number | null,
  hardwareUnit: string | null | undefined,
  abbreviation: Record<string, string> | null,
): SellableUnit {
  if (id !== null && name !== null && precision !== null) {
    return {
      id,
      name,
      precision,
      abbreviation: abbreviation ?? {},
      hardwareUnit: hardwareUnit as SellableUnit["hardwareUnit"],
    };
  }
  // A product with no stored unit reads as Each (never stored).
  return EACH_UNIT;
}

function legacyPricingUnit(unit: SellableUnit): PricingUnit {
  return unit.hardwareUnit === null ? "each" : "weight";
}

export async function createCatalogue(
  tx: Transaction,
  input: { name: string },
): Promise<Catalogue> {
  const [row] = await tx
    .insert(catalogues)
    .values({ name: input.name })
    .returning(CATALOGUE_COLUMNS);
  return row!;
}

export async function listCatalogues(tx: Transaction): Promise<Catalogue[]> {
  return tx.select(CATALOGUE_COLUMNS).from(catalogues).orderBy(catalogues.createdAt, catalogues.id);
}

export async function createMenuSection(
  tx: Transaction,
  input: { menuId: string; name: Record<string, string>; displayOrder?: number },
): Promise<MenuSection> {
  const [row] = await tx.insert(menuSections).values(input).returning({
    id: menuSections.id,
    menuId: menuSections.menuId,
    name: menuSections.name,
    displayOrder: menuSections.displayOrder,
    active: menuSections.active,
  });
  return row!;
}

export async function listMenuSections(tx: Transaction, menuId: string): Promise<MenuSection[]> {
  const [menu] = await tx
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(eq(catalogues.id, menuId));
  if (menu === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  return tx
    .select({
      id: menuSections.id,
      menuId: menuSections.menuId,
      name: menuSections.name,
      displayOrder: menuSections.displayOrder,
      active: menuSections.active,
    })
    .from(menuSections)
    .where(eq(menuSections.menuId, menuId))
    .orderBy(menuSections.displayOrder, menuSections.id);
}

export async function updateMenuSection(
  tx: Transaction,
  sectionId: string,
  patch: { name: Record<string, string> },
): Promise<void> {
  const [row] = await tx
    .update(menuSections)
    .set(patch)
    .where(eq(menuSections.id, sectionId))
    .returning({ id: menuSections.id });
  if (row === undefined) throw new AppError("menu_section.not_found", { sectionId });
}

export async function createMenuItem(
  tx: Transaction,
  input: {
    menuId: string;
    productId: string;
    sectionId: string;
    grossPrice: string;
    displayOrder?: number;
  },
): Promise<MenuItem> {
  await lockModifierDefinitions(tx);
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (product === undefined)
    throw new AppError("product.not_found", { productId: input.productId });
  const [section] = await tx
    .select({ id: menuSections.id })
    .from(menuSections)
    .where(and(eq(menuSections.menuId, input.menuId), eq(menuSections.id, input.sectionId)));
  if (section === undefined) {
    throw new AppError("menu_section.not_found", {
      menuId: input.menuId,
      sectionId: input.sectionId,
    });
  }
  const [existing] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.menuId, input.menuId), eq(menuItems.productId, input.productId)));
  const [row] = await tx
    .insert(menuItems)
    .values(input)
    .onConflictDoUpdate({
      target: [menuItems.menuId, menuItems.productId],
      set: {
        sectionId: input.sectionId,
        grossPrice: input.grossPrice,
        displayOrder: input.displayOrder ?? 0,
        active: true,
      },
    })
    .returning({
      id: menuItems.id,
      menuId: menuItems.menuId,
      productId: menuItems.productId,
      sectionId: menuItems.sectionId,
      grossPrice: menuItems.grossPrice,
      displayOrder: menuItems.displayOrder,
      active: menuItems.active,
    });
  if (existing === undefined) {
    const defaults = await tx
      .select({
        groupId: productOptionGroups.groupId,
        optionId: optionGroupItems.id,
        priceDelta: optionGroupItems.priceDelta,
      })
      .from(productOptionGroups)
      .innerJoin(
        optionGroups,
        and(eq(optionGroups.id, productOptionGroups.groupId), eq(optionGroups.active, true)),
      )
      .leftJoin(
        optionGroupItems,
        and(
          eq(optionGroupItems.groupId, productOptionGroups.groupId),
          eq(optionGroupItems.active, true),
        ),
      )
      .where(eq(productOptionGroups.productId, input.productId))
      .orderBy(productOptionGroups.sort, optionGroupItems.sort, optionGroupItems.id);
    const byGroup = new Map<
      string,
      { groupId: string; options: { optionId: string; priceDelta: string }[] }
    >();
    for (const option of defaults) {
      const group = byGroup.get(option.groupId) ?? { groupId: option.groupId, options: [] };
      if (option.optionId !== null)
        group.options.push({ optionId: option.optionId, priceDelta: option.priceDelta! });
      byGroup.set(option.groupId, group);
    }
    if (byGroup.size > 0) {
      await setMenuItemOptionGroups(tx, row!.id, [...byGroup.values()]);
    }
  }
  return row!;
}

export async function updateMenuItem(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  patch: { sectionId?: string; grossPrice?: string; displayOrder?: number },
): Promise<void> {
  const [row] = await tx
    .update(menuItems)
    .set(patch)
    .where(
      and(eq(menuItems.menuId, menuId), eq(menuItems.id, menuItemId), eq(menuItems.active, true)),
    )
    .returning({ id: menuItems.id });
  if (row === undefined) throw new AppError("menu_item.not_found", { menuId, menuItemId });
}

export async function deactivateMenuItem(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
): Promise<void> {
  const [row] = await tx
    .update(menuItems)
    .set({ active: false })
    .where(
      and(eq(menuItems.menuId, menuId), eq(menuItems.id, menuItemId), eq(menuItems.active, true)),
    )
    .returning({ id: menuItems.id });
  if (row === undefined) throw new AppError("menu_item.not_found", { menuId, menuItemId });
}

/** Replace the groups and choices offered for one menu item, including their menu-specific prices. */
export async function setMenuItemOptionGroups(
  tx: Transaction,
  menuItemId: string,
  groups: {
    groupId: string;
    options: { optionId: string; priceDelta: string }[];
  }[],
): Promise<void> {
  await lockModifierDefinitions(tx);
  const [menuItem] = await tx
    .select({ productId: menuItems.productId })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));
  if (menuItem === undefined) throw new AppError("menu_item.not_found", { menuItemId });

  const groupIds = groups.map((group) => group.groupId);
  if (new Set(groupIds).size !== groupIds.length) {
    throw new AppError("options.group_invalid", { reason: "duplicate" });
  }
  const requiredGroups = await tx
    .select({ id: productOptionGroups.groupId })
    .from(productOptionGroups)
    .innerJoin(optionGroups, eq(optionGroups.id, productOptionGroups.groupId))
    .where(
      and(
        eq(productOptionGroups.productId, menuItem.productId),
        eq(optionGroups.required, true),
        eq(optionGroups.active, true),
      ),
    );
  if (requiredGroups.some((group) => !groupIds.includes(group.id))) {
    throw new AppError("options.group_invalid", { reason: "required_group_missing" });
  }
  if (groupIds.length > 0) {
    const attached = await tx
      .select({ groupId: productOptionGroups.groupId })
      .from(productOptionGroups)
      .where(
        and(
          eq(productOptionGroups.productId, menuItem.productId),
          inArray(productOptionGroups.groupId, groupIds),
        ),
      );
    if (attached.length !== groupIds.length) {
      throw new AppError("options.group_invalid", { reason: "not_attached" });
    }

    const definitions = await tx
      .select({ id: optionGroups.id, minSelect: optionGroups.minSelect, type: optionGroups.type })
      .from(optionGroups)
      .where(inArray(optionGroups.id, groupIds));
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
    for (const group of groups) {
      const definition = definitionById.get(group.groupId);
      if (definition === undefined) {
        throw new AppError("options.group_invalid", { reason: "not_attached" });
      }
      for (const option of group.options) {
        if (
          typeof option.priceDelta !== "string" ||
          !isModifierPrice(option.priceDelta) ||
          (definition.type !== "extras" && Number(option.priceDelta) !== 0)
        ) {
          throw new AppError("modifier.invalid", { field: "priceDelta" });
        }
      }
      const optionIds = group.options.map((option) => option.optionId);
      if (new Set(optionIds).size !== optionIds.length) {
        throw new AppError("options.item_invalid", { reason: "duplicate" });
      }
      if (
        (definition.type === "extras" || definition.type === "options") &&
        optionIds.length < definition.minSelect
      ) {
        throw new AppError("options.group_invalid", { reason: "insufficient_options" });
      }
      if (optionIds.length > 0) {
        const matchingOptions = await tx
          .select({ id: optionGroupItems.id })
          .from(optionGroupItems)
          .where(
            and(
              eq(optionGroupItems.groupId, group.groupId),
              eq(optionGroupItems.active, true),
              inArray(optionGroupItems.id, optionIds),
            ),
          );
        if (matchingOptions.length !== optionIds.length) {
          throw new AppError("options.item_invalid", { reason: "wrong_group_or_inactive" });
        }
      }
    }
  }

  await tx.delete(menuItemOptionGroups).where(eq(menuItemOptionGroups.menuItemId, menuItemId));
  if (groups.length === 0) return;
  await tx.insert(menuItemOptionGroups).values(
    groups.map((group, displayOrder) => ({
      menuItemId,
      groupId: group.groupId,
      displayOrder,
    })),
  );
  const options = groups.flatMap((group) =>
    group.options.map((option) => ({
      menuItemId,
      groupId: group.groupId,
      optionId: option.optionId,
      priceDelta: option.priceDelta,
    })),
  );
  if (options.length > 0) await tx.insert(menuItemOptions).values(options);
}

export async function listMenuOffers(tx: Transaction, menuIds: string[]): Promise<MenuOffer[]> {
  if (menuIds.length === 0) return [];
  const rows = await tx
    .select({
      id: menuItems.id,
      menuId: menuItems.menuId,
      productId: menuItems.productId,
      sectionId: menuItems.sectionId,
      grossPrice: menuItems.grossPrice,
      displayOrder: menuItems.displayOrder,
      active: menuItems.active,
      menuName: catalogues.name,
      sectionName: menuSections.name,
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
      unitId: units.id,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      unitPrecision: units.precision,
      hardwareUnit: units.hardwareUnit,
      pricingUnit: products.pricingUnit,
      vatClass: products.vatClass,
      category: categories.name,
      allergens: products.allergens,
      diet: products.diet,
      dietDerivation: products.dietDerivation,
      dietOverride: products.dietOverride,
      dietaryDeclarations: products.dietaryDeclarations,
      courseId: products.courseId,
    })
    .from(menuItems)
    .innerJoin(catalogues, eq(catalogues.id, menuItems.menuId))
    .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
    .innerJoin(products, eq(products.id, menuItems.productId))
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        inArray(menuItems.menuId, menuIds),
        eq(menuItems.active, true),
        eq(menuSections.active, true),
        eq(catalogues.active, true),
        eq(products.active, true),
      ),
    )
    .orderBy(catalogues.name, menuSections.displayOrder, menuItems.displayOrder, menuItems.id);
  if (rows.length === 0) return [];
  const optionRows = await tx
    .select({
      menuItemId: menuItemOptionGroups.menuItemId,
      groupId: optionGroups.id,
      groupName: optionGroups.name,
      minSelect: optionGroups.minSelect,
      maxSelect: optionGroups.maxSelect,
      required: optionGroups.required,
      optionId: optionGroupItems.id,
      optionName: optionGroupItems.name,
      priceDelta: menuItemOptions.priceDelta,
      maxQuantity: optionGroupItems.maxQuantity,
      vatClass: optionGroupItems.vatClass,
      addAllergens: optionGroupItems.addAllergens,
      suitableFor: optionGroupItems.dietarySuitability,
    })
    .from(menuItemOptionGroups)
    .innerJoin(optionGroups, eq(optionGroups.id, menuItemOptionGroups.groupId))
    .innerJoin(
      menuItemOptions,
      and(
        eq(menuItemOptions.menuItemId, menuItemOptionGroups.menuItemId),
        eq(menuItemOptions.groupId, menuItemOptionGroups.groupId),
      ),
    )
    .innerJoin(
      optionGroupItems,
      and(
        eq(optionGroupItems.id, menuItemOptions.optionId),
        eq(optionGroupItems.groupId, menuItemOptions.groupId),
      ),
    )
    .where(
      and(
        inArray(
          menuItemOptionGroups.menuItemId,
          rows.map((row) => row.id),
        ),
        eq(optionGroups.active, true),
        eq(optionGroupItems.active, true),
      ),
    )
    .orderBy(
      menuItemOptionGroups.displayOrder,
      optionGroups.id,
      optionGroupItems.sort,
      optionGroupItems.id,
    );
  const groupsByItem = new Map<string, MenuOfferOptionGroup[]>();
  for (const option of optionRows) {
    let groups = groupsByItem.get(option.menuItemId);
    if (groups === undefined) {
      groups = [];
      groupsByItem.set(option.menuItemId, groups);
    }
    let group = groups.find((candidate) => candidate.id === option.groupId);
    if (group === undefined) {
      group = {
        id: option.groupId,
        name: option.groupName,
        minSelect: option.minSelect,
        maxSelect: option.maxSelect,
        required: option.required,
        options: [],
      };
      groups.push(group);
    }
    group.options.push({
      id: option.optionId,
      name: option.optionName,
      priceDelta: option.priceDelta,
      maxQuantity: option.maxQuantity,
      vatClass: option.vatClass as VatClass | null,
      addAllergens: option.addAllergens as ProductAllergens | null,
      suitableFor: option.suitableFor as string[] | null,
    });
  }
  const content = await readContentLanguages(tx, FALLBACK_LOCALE);
  const modifiersByItem = await readMenuModifiers(
    tx,
    rows.map((row) => row.id),
  );
  const variantRows = await tx
    .select({
      menuItemId: menuItemVariants.menuItemId,
      id: productVariants.id,
      name: productVariants.name,
      customerName: productVariants.customerName,
      kitchenName: productVariants.kitchenName,
      image: productVariants.image,
      unitPrice: menuItemVariants.unitPrice,
      productAvailable: productVariants.available,
      menuAvailable: menuItemVariants.available,
    })
    .from(menuItemVariants)
    .innerJoin(
      productVariants,
      and(
        eq(productVariants.productId, menuItemVariants.productId),
        eq(productVariants.id, menuItemVariants.variantId),
      ),
    )
    .where(
      inArray(
        menuItemVariants.menuItemId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(menuItemVariants.displayOrder, menuItemVariants.variantId);
  return rows.map((row) => ({
    id: row.id,
    menuId: row.menuId,
    productId: row.productId,
    sectionId: row.sectionId,
    grossPrice: row.grossPrice,
    displayOrder: row.displayOrder,
    active: row.active,
    menuName: row.menuName,
    sectionName: row.sectionName,
    name: row.name,
    customerName: row.customerName,
    kitchenName: row.kitchenName,
    unit: sellableUnit(
      row.unitId,
      row.unitName,
      row.unitPrecision,
      row.hardwareUnit,
      row.unitAbbreviation,
    ),
    pricingUnit: row.pricingUnit as PricingUnit,
    vatClass: row.vatClass as VatClass,
    category:
      row.category === null
        ? null
        : resolveContentText(row.category, content.defaultLanguage, content.defaultLanguage),
    allergens: row.allergens,
    diet: row.diet as DietProfile | null,
    dietDerivation: row.dietDerivation as DietDerivation | null,
    dietOverride: row.dietOverride as DietOverride | null,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
    courseId: row.courseId,
    optionGroups: groupsByItem.get(row.id) ?? [],
    modifiers: modifiersByItem.get(row.id) ?? [],
    variants: variantRows
      .filter((variant) => variant.menuItemId === row.id)
      .map((variant) => ({
        id: variant.id,
        name: variant.name,
        customerName: variant.customerName,
        kitchenName: variant.kitchenName,
        image: variant.image,
        unitPrice: variant.unitPrice,
        available: variant.productAvailable && variant.menuAvailable,
      })),
  }));
}

/**
 * Check an untrusted catalogue id before a location-menu write, so an absent catalogue produces
 * `catalogue.not_found` (404) instead of an opaque FK failure (23503). The foreign keys on
 * `locations.catalogue_id` and `location_catalogues.catalogue_id` remain the data-layer backstop
 * for a missing reference; this read checks existence only.
 */
export async function catalogueExists(tx: Transaction, catalogueId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(eq(catalogues.id, catalogueId));
  return row !== undefined;
}

export async function renameCatalogue(
  tx: Transaction,
  catalogueId: string,
  name: string,
): Promise<void> {
  const [row] = await tx
    .update(catalogues)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(catalogues.id, catalogueId))
    .returning({ id: catalogues.id });
  if (row === undefined) throw new AppError("catalogue.not_found", { catalogueId });
}

export async function deactivateCatalogue(tx: Transaction, id: string): Promise<void> {
  await tx
    .update(catalogues)
    .set({ active: false, updatedAt: sql`now()` })
    .where(eq(catalogues.id, id));
}

/**
 * Republish `products.allergens` from the two overlays on the row. `allergens` is a COMPUTED column:
 * staff author `manual_allergens`, the recipe module writes `recipe_derivation`, and the published
 * declaration is `republish(manual, derivation)` (derivation.ts). Called after any change to either
 * overlay — createProduct/updateProduct (manual) or applyRecipeDerivation (derivation).
 *
 * `id` is CALLER-supplied at the update/derivation call sites (an `UPDATE … WHERE id = $id` that
 * silently touches zero rows when the id doesn't exist), so the SELECT may return no row. That is a
 * no-op, matching `updateProduct`'s pre-existing "missing id is a silent no-op" semantics: `republish`
 * of two nulls is null and the follow-up UPDATE also matches nothing.
 */
async function republishProduct(tx: Transaction, id: string): Promise<void> {
  const [row] = await tx
    .select({ manual: products.manualAllergens, derivation: products.recipeDerivation })
    .from(products)
    .where(eq(products.id, id));
  const published = republish(row?.manual ?? null, row?.derivation ?? null);
  await tx.update(products).set({ allergens: published }).where(eq(products.id, id));
}

/**
 * Set a product's recipe-derived overlay and republish its declaration. The seam `@waitron/recipes`
 * (Task 5) calls when a recipe or its ingredients change; `null` clears the derivation (no recipe),
 * after which the published declaration reverts to the manual overlay alone.
 */
export async function applyRecipeDerivation(
  tx: Transaction,
  productId: string,
  derivation: RecipeDerivation | null,
): Promise<void> {
  await tx
    .update(products)
    .set({ recipeDerivation: derivation, updatedAt: sql`now()` })
    .where(eq(products.id, productId));
  await republishProduct(tx, productId);
}

/**
 * Republish `products.diet` from the two diet overlays on the row — the diet twin of
 * {@link republishProduct}. `diet` is COMPUTED: the recipe module writes `diet_derivation` (the
 * folded ingredient origins + a `pending` flag), staff author `diet_override`, and the published
 * profile is `overlayDietProfile(deriveDietProfile(derivation), override)` (dietary.ts). Called after
 * any change to either overlay — createProduct/updateProduct (override) or applyDietDerivation
 * (derivation). A missing/absent derivation folds as "no recipe": empty origins but PENDING, so the
 * published vegan/vegetarian read "unknown" (the CAUTIOUS posture — an unreviewed dish must never
 * assert a positive diet claim), mirroring the allergen `republish`'s null-derivation → pending. A
 * well-formed id that names no row is a silent no-op (the SELECT returns nothing, the UPDATE matches
 * nothing), matching {@link republishProduct}.
 */
async function republishProductDiet(tx: Transaction, id: string): Promise<void> {
  const [row] = await tx
    .select({ deriv: products.dietDerivation, override: products.dietOverride })
    .from(products)
    .where(eq(products.id, id));
  const derivation = (row?.deriv ?? { origins: [], pending: true }) as DietDerivation;
  const derived = deriveDietProfile(derivation);
  const published = overlayDietProfile(derived, (row?.override ?? null) as DietOverride | null);
  await tx.update(products).set({ diet: published }).where(eq(products.id, id));
}

/**
 * Republish BOTH `products.allergens` and `products.diet` from the row's four overlay columns in a
 * SINGLE SELECT + a SINGLE UPDATE — the combined form of {@link republishProduct} +
 * {@link republishProductDiet}, for the common `updateProduct` case that changed BOTH overlays. Each
 * published value is computed EXACTLY as the two functions do (`republish(manual, derivation)` for
 * allergens; `overlayDietProfile(deriveDietProfile(derivation), override)` for diet, with the same
 * empty-recipe default of `{ origins: [], pending: true }`), so the pair of columns lands byte-for-byte
 * where the two separate round trips would have left them — one query pair instead of two. A
 * well-formed id that names no row is a silent no-op (the SELECT returns nothing, the UPDATE matches
 * nothing), matching both single-overlay functions.
 */
async function republishProductOverlays(tx: Transaction, id: string): Promise<void> {
  const [row] = await tx
    .select({
      manual: products.manualAllergens,
      recipeDerivation: products.recipeDerivation,
      deriv: products.dietDerivation,
      override: products.dietOverride,
    })
    .from(products)
    .where(eq(products.id, id));
  const publishedAllergens = republish(row?.manual ?? null, row?.recipeDerivation ?? null);
  const derivation = (row?.deriv ?? { origins: [], pending: true }) as DietDerivation;
  const publishedDiet = overlayDietProfile(
    deriveDietProfile(derivation),
    (row?.override ?? null) as DietOverride | null,
  );
  await tx
    .update(products)
    .set({ allergens: publishedAllergens, diet: publishedDiet })
    .where(eq(products.id, id));
}

/**
 * Set a product's recipe-derived diet overlay and republish its diet profile — the diet twin of
 * {@link applyRecipeDerivation}. `@waitron/recipes` calls it when a recipe or its ingredients change;
 * `null` clears the derivation (no recipe), after which the published profile reverts to the override
 * overlaid on the empty, PENDING derived profile — vegan/vegetarian read "unknown" unless the override
 * forces them (the cautious posture: an unreviewed dish asserts no positive diet claim).
 */
export async function applyDietDerivation(
  tx: Transaction,
  productId: string,
  derivation: DietDerivation | null,
): Promise<void> {
  await tx
    .update(products)
    .set({ dietDerivation: derivation, updatedAt: sql`now()` })
    .where(eq(products.id, productId));
  await republishProductDiet(tx, productId);
}

export async function createProduct(tx: Transaction, input: CreateProductInput): Promise<Product> {
  if (input.unitId === undefined && input.pricingUnit === undefined) {
    throw new AppError("product.invalid", { field: "unitId" });
  }
  // Resolve to the unit to assign, or null for Each (no product_units row stored).
  let selectedUnit: SellableUnit | null;
  if (input.unitId === null) {
    selectedUnit = null;
  } else if (input.unitId !== undefined) {
    selectedUnit = await getSellableUnit(tx, input.unitId); // 404s an unknown unit
  } else if (input.pricingUnit === "each") {
    selectedUnit = null;
  } else if (input.pricingUnit === "weight") {
    selectedUnit = await getSeededUnit(tx, "kg"); // legacy weight → the retained kg seed
    if (selectedUnit === null) throw new AppError("product.invalid", { field: "unitId" });
  } else {
    // Any other legacy `pricingUnit` value is rejected at the boundary, not silently treated as weight.
    throw new AppError("product.invalid", { field: "pricingUnit" });
  }
  // Validate before the write: an unreviewed product stores null, a supplied map is checked against
  // the EU-14 taxonomy and rejected (throws `allergen.invalid_code`/`allergen.invalid_presence`)
  // before any row is inserted. The map is the MANUAL overlay; at create there is no recipe, so the
  // published `allergens` is `republish(manual, null)` — which is exactly `manual` (or null when
  // unreviewed), preserving today's round-trip behaviour.
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  // The diet override is the staff overlay; at create there is no recipe (no derivation), so the
  // published `diet` is the override overlaid on the EMPTY, PENDING derived profile — the override's
  // own labels win, and any label it does not set reads "unknown" (the CAUTIOUS posture: an
  // unreviewed dish never asserts a positive vegan/vegetarian claim, mirroring the allergen twin's
  // pending). Checked disjoint before the write (defence-in-depth, never trust the caller —
  // CLAUDE.md §3). The recipe fold overwrites `diet` once a recipe is set (applyDietDerivation →
  // republishProductDiet).
  // Validate the untrusted override (labels ∈ {yes,no}, contains-tags ∈ {meat,fish}, disjoint) before
  // the write — the diet twin of `validateAllergens`, defence-in-depth at the core (CLAUDE.md §3).
  const dietOverride = validateDietOverride(input.dietOverride ?? null);
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: input.catalogueId,
      categoryId: null,
      name: input.name,
      customerName: input.customerName ?? null,
      description: input.description ?? null,
      kitchenName: input.kitchenName?.trim() || null,
      dietaryDeclarations: validateDietaryDeclarations(input.dietaryDeclarations ?? []),
      pricingUnit: selectedUnit === null ? "each" : legacyPricingUnit(selectedUnit),
      unitPrice: input.unitPrice,
      vatClass: input.vatClass,
      active: input.active ?? true,
      soldAlone: input.soldAlone ?? true,
      manualAllergens: allergens,
      allergens: republish(allergens, null),
      dietOverride,
      diet: overlayDietProfile(deriveDietProfile({ origins: [], pending: true }), dietOverride),
      image: input.image ?? null,
    })
    .returning({ id: products.id });
  if (selectedUnit !== null) await assignProductUnit(tx, row!.id, selectedUnit.id);
  const membership = await replaceProductCategories(tx, row!.id, {
    categoryIds: input.categoryId === null ? [] : [input.categoryId],
    primaryCategoryId: input.categoryId,
  });
  const [created] = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(eq(products.id, row!.id));
  return toProduct(
    { ...created!, categoryId: membership.primaryCategoryId },
    membership.categoryIds,
  );
}

export async function listProducts(tx: Transaction, catalogueId?: string): Promise<Product[]> {
  const rows = await tx
    .select({
      ...PRODUCT_COLUMNS,
      categoryIds: sql<
        string[]
      >`coalesce(array_agg(${productCategories.categoryId}::text order by ${productCategories.categoryId}) filter (where ${productCategories.categoryId} is not null), array[]::text[])`,
    })
    .from(products)
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(productCategories, eq(productCategories.productId, products.id))
    .where(catalogueId === undefined ? undefined : eq(products.catalogueId, catalogueId))
    .groupBy(products.id, units.id)
    .orderBy(products.createdAt, products.id);
  if (rows.length === 0) return [];
  const attachments = await tx
    .select({ productId: productOptionGroups.productId, groupId: productOptionGroups.groupId })
    .from(productOptionGroups)
    .where(
      inArray(
        productOptionGroups.productId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(productOptionGroups.sort, productOptionGroups.groupId);
  const variantRows = await tx
    .select({
      productId: productVariants.productId,
      id: productVariants.id,
      name: productVariants.name,
      customerName: productVariants.customerName,
      kitchenName: productVariants.kitchenName,
      image: productVariants.image,
      unitPrice: productVariants.unitPrice,
      available: productVariants.available,
    })
    .from(productVariants)
    .where(
      inArray(
        productVariants.productId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(productVariants.displayOrder, productVariants.id);
  return rows.map((row) => ({
    ...toProduct(
      row,
      row.categoryIds,
      variantRows.filter((variant) => variant.productId === row.id),
    ),
    modifierIds: attachments
      .filter((attachment) => attachment.productId === row.id)
      .map((attachment) => attachment.groupId),
  }));
}

export async function updateProduct(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
): Promise<void> {
  // `allergens` is the MANUAL overlay now, not the published column: split it out of the generic
  // patch and write it to `manual_allergens`, then republish. A supplied map is validated before the
  // write; `null` (clear) and `undefined` (leave unchanged) both skip validation, and only `null`
  // reaches `manual_allergens`. The remaining `rest` keys map 1:1 to `products` columns, so the
  // spread stays fully typed against `.set()` — no `Record<string, unknown>` widening. Republish only
  // when `allergens` was in the patch: an unrelated edit must not disturb the published declaration.
  const { allergens, dietOverride, dietaryDeclarations, categoryId, unitId, pricingUnit, ...rest } =
    patch;
  if (categoryId !== undefined) {
    // Choosing a primary retains other memberships; clearing is allowed only for the final membership.
    //
    // This branch KEEPS the old coupling between the reporting category and membership on purpose,
    // and is the only write path that still does. Clearing here refuses outright when the product
    // has more than one membership (`category.primary_required`), and when it is allowed it clears
    // every membership with it. `replaceProductCategories` — what the membership picker and the
    // product editor call — treats the two independently: a product may hold memberships with no
    // reporting category. The relaxed behaviour is not extended to this path because no first-party
    // caller sends `categoryId` in a product patch any more (the single-select `product-form.ts` is
    // the only thing that ever did, and nothing mounts it), so changing it would alter a legacy
    // route's contract with nothing to gain. `docs/developers/product-categories.md` says which
    // path is which; `docs/backlog.md` carries removing this one when a client needs it relaxed.
    await lockCategories(tx);
    const current = await readProductCategories(tx, id);
    if (categoryId === null && current.categoryIds.length > 1)
      throw new AppError("category.primary_required", {});
    await replaceProductCategories(tx, id, {
      categoryIds: categoryId === null ? [] : [...new Set([...current.categoryIds, categoryId])],
      primaryCategoryId: categoryId,
    });
  }
  if (allergens != null) validateAllergens(allergens);
  // The diet override is split out like `allergens`: a supplied override is checked disjoint before
  // the write (`null`/`undefined` skip it), only a non-`undefined` value reaches the `diet_override`
  // column, and `diet` is republished only when the override was in the patch — an unrelated edit
  // must not disturb the published diet profile. Mirrors the allergen republish guard exactly.
  if (dietOverride !== undefined) validateDietOverride(dietOverride);
  const directDietary =
    dietaryDeclarations === undefined
      ? undefined
      : validateDietaryDeclarations(dietaryDeclarations);
  // Tri-state: `null` clears the unit, a real id sets it, and an omitted unit is left unchanged
  // unless the legacy `pricingUnit` compat field is supplied instead ("each" clears, "weight" sets kg).
  type UnitAction = { kind: "keep" } | { kind: "clear" } | { kind: "set"; unit: SellableUnit };
  let unitAction: UnitAction;
  if (unitId === null) {
    unitAction = { kind: "clear" };
  } else if (unitId !== undefined) {
    unitAction = { kind: "set", unit: await getSellableUnit(tx, unitId) };
  } else if (pricingUnit === undefined) {
    unitAction = { kind: "keep" };
  } else if (pricingUnit === "each") {
    unitAction = { kind: "clear" };
  } else if (pricingUnit === "weight") {
    const kg = await getSeededUnit(tx, "kg");
    if (kg === null) throw new AppError("product.invalid", { field: "unitId" });
    unitAction = { kind: "set", unit: kg };
  } else {
    // Any other legacy `pricingUnit` value is rejected at the boundary, not silently treated as weight.
    throw new AppError("product.invalid", { field: "pricingUnit" });
  }
  await tx
    .update(products)
    .set({
      ...rest,
      ...(unitAction.kind === "keep"
        ? {}
        : {
            pricingUnit: unitAction.kind === "clear" ? "each" : legacyPricingUnit(unitAction.unit),
          }),
      ...(allergens !== undefined ? { manualAllergens: allergens } : {}),
      ...(dietOverride !== undefined ? { dietOverride } : {}),
      ...(directDietary === undefined ? {} : { dietaryDeclarations: directDietary }),
      updatedAt: sql`now()`,
    })
    .where(eq(products.id, id));
  if (unitAction.kind === "set") await assignProductUnit(tx, id, unitAction.unit.id);
  else if (unitAction.kind === "clear") await clearProductUnit(tx, id);
  // Republish exactly the overlays that changed. When BOTH did, one combined SELECT+UPDATE
  // (`republishProductOverlays`) does the work of the two single-overlay round trips, landing the same
  // `allergens` and `diet` values; when only one changed, the matching single-overlay function runs so
  // the untouched column is never even re-read.
  if (allergens !== undefined && dietOverride !== undefined) {
    await republishProductOverlays(tx, id);
  } else if (allergens !== undefined) {
    await republishProduct(tx, id);
  } else if (dietOverride !== undefined) {
    await republishProductDiet(tx, id);
  }
}

export async function deactivateProduct(tx: Transaction, id: string): Promise<void> {
  await tx
    .update(products)
    .set({ active: false, updatedAt: sql`now()` })
    .where(eq(products.id, id));
}

export async function assignCatalogueToLocation(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
  await tx.update(locations).set({ catalogueId }).where(eq(locations.id, locationId));
}

/**
 * Make `catalogueId` the location's default menu (`locations.catalogue_id`) while KEEPING the old
 * default sellable — the owner-chosen "keep-sellable" behaviour: an owner picking a new default does
 * not expect the previous menu to stop being sold, so the old default is demoted to a
 * `location_catalogues` member rather than dropped. "Which menus does this location sell?" and "which
 * one opens first?" stay independent. A location with no prior default (or one already set to
 * `catalogueId`) skips the demote. The redundant member row `catalogueId` may already hold is left
 * untouched — {@link resolveAccessibleCatalogueIds} de-duplicates, so it is invisible.
 */
export async function setLocationDefaultCatalogue(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
  // Only the current default matters here, so read `locations.catalogue_id` DIRECTLY rather than via
  // `resolveAccessibleCatalogueIds` — that helper also SELECTs the `location_catalogues` members and
  // builds a Set the demote logic never consults, a wasted round-trip on every default change.
  const [row] = await tx
    .select({ id: locations.catalogueId })
    .from(locations)
    .where(eq(locations.id, locationId));
  const defaultId = row?.id ?? null;
  if (defaultId !== null && defaultId !== catalogueId) {
    await addCatalogueToLocation(tx, locationId, defaultId);
  }
  await assignCatalogueToLocation(tx, locationId, catalogueId);
}

/**
 * Attach a NON-default catalogue to a location's accessible set (a `location_catalogues` row): the
 * location may then sell from it alongside its default `catalogue_id`. Idempotent — the primary key
 * (location_id, catalogue_id) makes a re-attach a no-op via `onConflictDoNothing`. The
 * default assignment stays with {@link assignCatalogueToLocation}; this only adds OTHER menus.
 */
export async function addCatalogueToLocation(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
  await tx.insert(locationCatalogues).values({ locationId, catalogueId }).onConflictDoNothing();
}

/**
 * Detach a catalogue from a location's accessible set (delete its `location_catalogues` row): the
 * location stops selling from it. Idempotent — deleting a row that is not there is a no-op. This
 * NEVER touches the default (`locations.catalogue_id`), which is not stored as a member row, so it
 * cannot strip a location's default menu; call {@link assignCatalogueToLocation} to change the
 * default. `app_user` holds DELETE on `location_catalogues`.
 */
export async function removeCatalogueFromLocation(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
  await tx
    .delete(locationCatalogues)
    .where(
      and(
        eq(locationCatalogues.locationId, locationId),
        eq(locationCatalogues.catalogueId, catalogueId),
      ),
    );
}

/**
 * The catalogue ids a location may sell from: its default (`locations.catalogue_id`, when non-null)
 * unioned with every `location_catalogues` member, de-duplicated (a `Set`, since the default may also
 * appear as a member). Order is not meaningful — {@link listAvailableProducts} sorts by catalogue
 * name — so `ids` is just the set's insertion order. `defaultId` is the same `locations.catalogue_id`
 * the union already read (or `null` when the location has none): returned alongside so a caller that
 * needs to flag the default menu ({@link listAccessibleCatalogues}) does not re-read `locations`.
 * `invoiceLocales` is that SAME `locations` row's `invoice_locales` (empty only when the location does
 * not exist), projected here so the sale path ({@link listAvailableProducts} → `priceOrderLines`) gets
 * it from this ONE read rather than issuing a second single-row `locations` query.
 */
export async function resolveAccessibleCatalogueIds(
  tx: Transaction,
  locationId: string,
): Promise<{ ids: string[]; defaultId: string | null; invoiceLocales: string[] }> {
  const [def] = await tx
    .select({ id: locations.catalogueId, invoiceLocales: locations.invoiceLocales })
    .from(locations)
    .where(eq(locations.id, locationId));
  const members = await tx
    .select({ id: locationCatalogues.catalogueId })
    .from(locationCatalogues)
    .where(eq(locationCatalogues.locationId, locationId));
  const ids = new Set<string>();
  if (def?.id != null) ids.add(def.id);
  for (const m of members) ids.add(m.id);
  return { ids: [...ids], defaultId: def?.id ?? null, invoiceLocales: def?.invoiceLocales ?? [] };
}

export interface LocationCatalogue extends Catalogue {
  /** In this location's accessible set — its default (`locations.catalogue_id`) OR a
   * `location_catalogues` member. The set the till sells from. */
  sellable: boolean;
  /** This location's default menu (`locations.catalogue_id`); always also `sellable`. */
  isDefault: boolean;
}

/**
 * EVERY catalogue, each flagged with whether `locationId` may sell from it
 * (`sellable`) and whether it is that location's default (`isDefault`) — the dashboard's
 * location↔menu membership screen. Unlike {@link listAccessibleCatalogues} (which returns ONLY the
 * accessible set, for the till), this returns the full list so the screen can offer the not-yet-sold
 * catalogues to add. Order follows {@link listCatalogues} (creation order); the screen sorts for
 * display.
 */
export async function listCataloguesForLocation(
  tx: Transaction,
  locationId: string,
): Promise<LocationCatalogue[]> {
  const all = await listCatalogues(tx);
  const { ids, defaultId } = await resolveAccessibleCatalogueIds(tx, locationId);
  const sellable = new Set(ids);
  return all.map((c) => ({ ...c, sellable: sellable.has(c.id), isDefault: c.id === defaultId }));
}

/**
 * The active catalogues (menus) `locationId` may sell from — its default plus any
 * `location_catalogues` members (see {@link resolveAccessibleCatalogueIds}) — for the till's menu
 * switcher. `isDefault` flags the one row matching `locations.catalogue_id`. Ordered default-first,
 * then by name, so the switcher's default entry always sorts to the top regardless of naming.
 * Returns `[]` when the location has no accessible catalogue at all.
 */
export async function listAccessibleCatalogues(
  tx: Transaction,
  locationId: string,
): Promise<AccessibleCatalogue[]> {
  const { ids, defaultId } = await resolveAccessibleCatalogueIds(tx, locationId);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: catalogues.id, name: catalogues.name })
    .from(catalogues)
    .where(and(inArray(catalogues.id, ids), eq(catalogues.active, true)));
  return rows
    .map((r) => ({ id: r.id, name: r.name, isDefault: r.id === defaultId }))
    .sort((a, b) =>
      a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
    );
}

/**
 * The products the till can sell at `locationId`, across the WHOLE accessible catalogue set (the
 * default plus any `location_catalogues` members — see {@link resolveAccessibleCatalogueIds}), each
 * row tagged with the `catalogueId`/`catalogueName` it came from. Keeps only active products of an
 * active catalogue, with the category NAME resolved via a left join (null when the product has no
 * category). `products` is `[]` when the location has no accessible catalogue at all. Ordered by
 * catalogue name, then product `created_at`, then `id` so the result is stable and grouped by menu.
 *
 * Returns the location's `invoiceLocales` ALONGSIDE the products — both derived from the single
 * `resolveAccessibleCatalogueIds` read of `locations` — so the sale path (`priceOrderLines`) re-keys
 * catalogue content to the fiscal line's full tags without a SECOND `locations` query. `invoiceLocales`
 * is `[]` ONLY when the `locations` row is missing; `products` empties more broadly (any location with
 * no accessible catalogue), so the two emptiness conditions are NOT equivalent — a real location with
 * an empty catalogue returns `[]` products but its actual `invoiceLocales`.
 */
export async function listAvailableProducts(
  tx: Transaction,
  locationId: string,
): Promise<{ products: AvailableProduct[]; invoiceLocales: string[] }> {
  const { ids: accessible, invoiceLocales } = await resolveAccessibleCatalogueIds(tx, locationId);
  if (accessible.length === 0) return { products: [], invoiceLocales };
  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      customerName: products.customerName,
      unitId: units.id,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      unitPrecision: units.precision,
      hardwareUnit: units.hardwareUnit,
      pricingUnit: products.pricingUnit,
      unitPrice: products.unitPrice,
      vatClass: products.vatClass,
      category: categories.name,
      categoryLanguage: contentLanguages.defaultLanguage,
      allergens: products.allergens,
      diet: products.diet,
      dietDerivation: products.dietDerivation,
      dietOverride: products.dietOverride,
      dietaryDeclarations: products.dietaryDeclarations,
      courseId: products.courseId,
      catalogueId: catalogues.id,
      catalogueName: catalogues.name,
    })
    .from(products)
    .innerJoin(catalogues, eq(catalogues.id, products.catalogueId))
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(contentLanguages, sql`true`)
    .where(
      and(
        inArray(catalogues.id, accessible),
        eq(catalogues.active, true),
        eq(products.active, true),
      ),
    )
    .orderBy(catalogues.name, products.createdAt, products.id);

  // Attached option groups + items in ONE extra round trip (a grouped read, mirroring how the base
  // product read batches rather than issuing a query per product). Join
  // product_option_groups → option_groups → option_group_items across ALL the products just read,
  // keeping only ACTIVE groups (WHERE) and ACTIVE items (in the LEFT JOIN's ON, so an active group
  // with no active items still surfaces with `items: []` rather than being dropped). Groups are
  // ordered by the PER-ATTACHMENT `product_option_groups.sort` — the same reusable group can sit in a
  // different position on different products (schema comment, catalogue.ts), which the group's own
  // `option_groups.sort` cannot express — then item `sort`, with the ids as stable tiebreakers, so
  // first-seen order below IS sort order. Assembly groups the flat rows in JS: a product may attach
  // several groups, each several items, so the join fans out and is re-nested by (productId → groupId).
  const productIds = rows.map((row) => row.id);
  const groupsByProduct = new Map<string, ResolvedOptionGroup[]>();
  if (productIds.length > 0) {
    const optionRows = await tx
      .select({
        productId: productOptionGroups.productId,
        groupId: optionGroups.id,
        groupName: optionGroups.name,
        minSelect: optionGroups.minSelect,
        maxSelect: optionGroups.maxSelect,
        required: optionGroups.required,
        itemId: optionGroupItems.id,
        itemName: optionGroupItems.name,
        priceDelta: optionGroupItems.priceDelta,
        vatClass: optionGroupItems.vatClass,
        maxQuantity: optionGroupItems.maxQuantity,
        addAllergens: optionGroupItems.addAllergens,
        suitableFor: optionGroupItems.dietarySuitability,
      })
      .from(productOptionGroups)
      .innerJoin(optionGroups, eq(optionGroups.id, productOptionGroups.groupId))
      .leftJoin(
        optionGroupItems,
        and(eq(optionGroupItems.groupId, optionGroups.id), eq(optionGroupItems.active, true)),
      )
      .where(and(inArray(productOptionGroups.productId, productIds), eq(optionGroups.active, true)))
      .orderBy(
        productOptionGroups.sort,
        optionGroups.sort,
        optionGroups.id,
        optionGroupItems.sort,
        optionGroupItems.id,
      );
    // Per product, keep a groupId→group index (insertion order = sort order) so repeated item rows
    // for one group append to the same `items` array.
    const seen = new Map<string, Map<string, ResolvedOptionGroup>>();
    for (const r of optionRows) {
      let byGroup = seen.get(r.productId);
      if (byGroup === undefined) {
        byGroup = new Map();
        seen.set(r.productId, byGroup);
        groupsByProduct.set(r.productId, []);
      }
      let group = byGroup.get(r.groupId);
      if (group === undefined) {
        group = {
          id: r.groupId,
          name: r.groupName,
          minSelect: r.minSelect,
          maxSelect: r.maxSelect,
          required: r.required,
          items: [],
        };
        byGroup.set(r.groupId, group);
        groupsByProduct.get(r.productId)!.push(group);
      }
      // Null on the LEFT JOIN's item side = an active group with no active items: keep the empty group.
      if (r.itemId !== null) {
        group.items.push({
          id: r.itemId,
          name: r.itemName!,
          priceDelta: r.priceDelta!,
          vatClass: r.vatClass as VatClass | null,
          maxQuantity: r.maxQuantity!,
          addAllergens: r.addAllergens as ProductAllergens | null,
          suitableFor: r.suitableFor as string[] | null,
        });
      }
    }
  }

  const modifiersByProduct =
    rows.length === 0 ? new Map<string, Modifier[]>() : await readProductModifiers(tx, productIds);

  // `products` is the imported table, so the mapped rows take a local name of their own.
  const available = rows.map((row) => ({
    id: row.id,
    name: row.name,
    customerName: row.customerName,
    unit: sellableUnit(
      row.unitId,
      row.unitName,
      row.unitPrecision,
      row.hardwareUnit,
      row.unitAbbreviation,
    ),
    pricingUnit: row.pricingUnit as PricingUnit,
    unitPrice: row.unitPrice,
    vatClass: row.vatClass as VatClass,
    category:
      row.category === null
        ? null
        : resolveContentText(
            row.category,
            row.categoryLanguage ?? FALLBACK_LOCALE,
            row.categoryLanguage ?? FALLBACK_LOCALE,
          ),
    allergens: row.allergens,
    diet: row.diet as DietProfile | null,
    dietDerivation: row.dietDerivation as DietDerivation | null,
    dietOverride: row.dietOverride as DietOverride | null,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
    courseId: row.courseId,
    catalogueId: row.catalogueId,
    catalogueName: row.catalogueName,
    optionGroups: groupsByProduct.get(row.id) ?? [],
    modifiers: modifiersByProduct.get(row.id) ?? [],
  }));
  return { products: available, invoiceLocales };
}

/** A reusable `option_groups` row for the authoring editor (the whole row — active AND inactive, unlike
 * the sale-time {@link ResolvedOptionGroup}, which is active-only and carries resolved items). */
export interface OptionGroup {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  sort: number;
  active: boolean;
}

/** One `option_group_items` row for the authoring editor. `priceDelta` is the GROSS numeric column
 * carried as a string (like `unitPrice`); `vatClass` is null when the item INHERITS the parent dish's
 * rate. Unlike the sale-time {@link ResolvedOptionItem}, this carries `sort`/`active` for editing. */
export interface OptionGroupItem {
  id: string;
  groupId: string;
  name: Record<string, string>;
  priceDelta: string;
  vatClass: VatClass | null;
  sort: number;
  active: boolean;
  /** The most of this option a diner may take (`option_group_items.max_quantity`); 1 = no per-option
   * quantity. Always an integer >= 1, mirrored from the column's `>= 1` CHECK. */
  maxQuantity: number;
  /** The option's OWN allergens: codes this option declares, null when it declares none. */
  addAllergens: ProductAllergens | null;
}

export interface CreateOptionGroupInput {
  name: Record<string, string>;
  /** Omitted defaults mirror the `option_groups` column defaults: min 0, max 1, required false, sort
   * 0, active true. */
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  sort?: number;
  active?: boolean;
}

/** The mutable slice of an option group; absent keys are left unchanged. The select-bound invariant is
 * checked against the MERGE of this patch onto the stored row, so a partial patch that would violate it
 * (e.g. lowering `maxSelect` below the stored `minSelect`) is refused. */
export interface UpdateOptionGroupInput {
  name?: Record<string, string>;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  sort?: number;
  active?: boolean;
}

export interface CreateOptionGroupItemInput {
  name: Record<string, string>;
  /** Omitted defaults mirror the column defaults: priceDelta "0", vatClass null (inherit), sort 0,
   * active true, maxQuantity 1. */
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
  /** The per-option quantity cap; omitted defaults to 1 (no per-option quantity). An integer >= 1. */
  maxQuantity?: number;
  /** The option's OWN allergens. Omitted leaves the column NULL; `null` is the same. Validated before
   * the write — never trusted from the caller (CLAUDE.md §3). */
  addAllergens?: ProductAllergens | null;
}

export interface UpdateOptionGroupItemInput {
  name?: Record<string, string>;
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
  /** Absent leaves the stored value unchanged; a present value is re-validated as an integer >= 1. */
  maxQuantity?: number;
  /** Patch the option's OWN allergens. Omitted leaves the column unchanged; `null` clears it.
   * Validated before the write — never trusted from the caller (CLAUDE.md §3). */
  addAllergens?: ProductAllergens | null;
}

const OPTION_GROUP_COLUMNS = {
  id: optionGroups.id,
  name: optionGroups.name,
  minSelect: optionGroups.minSelect,
  maxSelect: optionGroups.maxSelect,
  required: optionGroups.required,
  sort: optionGroups.sort,
  active: optionGroups.active,
};

const OPTION_GROUP_ITEM_COLUMNS = {
  id: optionGroupItems.id,
  groupId: optionGroupItems.groupId,
  name: optionGroupItems.name,
  priceDelta: optionGroupItems.priceDelta,
  vatClass: optionGroupItems.vatClass,
  sort: optionGroupItems.sort,
  active: optionGroupItems.active,
  maxQuantity: optionGroupItems.maxQuantity,
  addAllergens: optionGroupItems.addAllergens,
};

// Legacy caps also populate max_total_quantity, whose finite values must be positive.
function validateOptionGroupBounds(minSelect: number, maxSelect: number, required: boolean): void {
  if (minSelect < 0 || maxSelect < 1 || maxSelect < minSelect) {
    throw new AppError("options.group_invalid", { reason: "select_bounds" });
  }
  if (required && minSelect < 1) {
    throw new AppError("options.group_invalid", { reason: "required_without_min" });
  }
}

/**
 * Enforce the `option_group_items` per-option-quantity invariant BEFORE the write: `max_quantity` must
 * be an integer >= 1 (1 = no per-option quantity), so an invalid value is a clean `options.item_invalid`
 * (400) rather than the opaque 500 the `option_group_items_qty_ck` CHECK (catalogue.ts) would raise as a
 * backstop. Parallel to `validateOptionGroupBounds`; `reason` is the stable field-naming code
 * `"max_quantity"` a translator renders, matching the group-level `options.group_invalid` shape.
 */
function validateOptionGroupItemMaxQuantity(maxQuantity: number): void {
  if (!Number.isInteger(maxQuantity) || maxQuantity < 1) {
    throw new AppError("options.item_invalid", { reason: "max_quantity" });
  }
}

/**
 * Validate and normalise the option's own-allergens patch. Returns `undefined` when the caller did not
 * touch `addAllergens` (so the write omits the column and the row default applies), otherwise
 * `{ addAllergens }` — `null` when cleared, the validated map when present. An empty map `{}` collapses
 * to NULL so the column has a single "no allergens" representation. Validated regardless of caller —
 * never trusted (CLAUDE.md §3).
 */
function normalizeOverlay(input: {
  addAllergens?: ProductAllergens | null;
}): { addAllergens: ProductAllergens | null } | undefined {
  if (input.addAllergens === undefined) return undefined;
  const add = input.addAllergens == null ? null : validateAllergens(input.addAllergens);
  return { addAllergens: add && Object.keys(add).length > 0 ? add : null };
}

export async function createOptionGroup(
  tx: Transaction,
  input: CreateOptionGroupInput,
): Promise<OptionGroup> {
  await lockModifierDefinitions(tx);
  // Resolve the column defaults HERE so the invariant is validated against the values that will land
  // (the DB defaults are min 0, max 1, required false).
  const minSelect = input.minSelect ?? 0;
  const maxSelect = input.maxSelect ?? 1;
  const required = input.required ?? false;
  validateOptionGroupBounds(minSelect, maxSelect, required);
  const [row] = await tx
    .insert(optionGroups)
    .values({
      name: input.name,
      minSelect,
      maxSelect,
      maxTotalQuantity: maxSelect,
      required,
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.active === undefined ? {} : { active: input.active }),
    })
    .returning(OPTION_GROUP_COLUMNS);
  return row!;
}

/** Every option group (active AND inactive), for the authoring editor. Ordered by `sort`
 * then `id` so the editor list is stable. */
export async function listOptionGroups(tx: Transaction): Promise<OptionGroup[]> {
  return tx
    .select(OPTION_GROUP_COLUMNS)
    .from(optionGroups)
    .orderBy(asc(optionGroups.sort), asc(optionGroups.id));
}

export async function updateOptionGroup(
  tx: Transaction,
  id: string,
  patch: UpdateOptionGroupInput,
): Promise<void> {
  await lockModifierDefinitions(tx);
  // Read the stored bounds and MERGE the patch onto them before validating: a partial patch that only
  // touches one of the three invariant fields (e.g. `required: true` with the stored `min_select`, or a
  // lowered `max_select` against the stored `min_select`) must be checked against the row it lands on,
  // not against defaults. A well-formed id that names no row is a silent no-op — the same posture
  // `updateProduct` takes — so a missing row skips both the validation and the (zero-row) UPDATE.
  const [current] = await tx
    .select({
      minSelect: optionGroups.minSelect,
      maxSelect: optionGroups.maxSelect,
      required: optionGroups.required,
    })
    .from(optionGroups)
    .where(eq(optionGroups.id, id));
  if (current === undefined) return;
  validateOptionGroupBounds(
    patch.minSelect ?? current.minSelect,
    patch.maxSelect ?? current.maxSelect,
    patch.required ?? current.required,
  );
  await tx
    .update(optionGroups)
    .set({
      ...patch,
      ...(patch.maxSelect === undefined ? {} : { maxTotalQuantity: patch.maxSelect }),
    })
    .where(eq(optionGroups.id, id));
}

export async function createOptionGroupItem(
  tx: Transaction,
  groupId: string,
  input: CreateOptionGroupItemInput,
): Promise<OptionGroupItem> {
  await lockModifierDefinitions(tx);
  // Resolve the default HERE so the invariant is validated against the value that will land (the DB
  // default is 1), the same posture createOptionGroup takes for its bounds.
  const maxQuantity = input.maxQuantity ?? 1;
  validateOptionGroupItemMaxQuantity(maxQuantity);
  const [row] = await tx
    .insert(optionGroupItems)
    .values({
      groupId,
      name: input.name,
      maxQuantity,
      ...(input.priceDelta === undefined ? {} : { priceDelta: input.priceDelta }),
      ...(input.vatClass === undefined ? {} : { vatClass: input.vatClass }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.active === undefined ? {} : { active: input.active }),
      // The allergen column defaults to NULL when the caller omits it; validated when present.
      ...(normalizeOverlay(input) ?? {}),
    })
    .returning(OPTION_GROUP_ITEM_COLUMNS);
  return {
    ...row!,
    vatClass: row!.vatClass as VatClass | null,
    addAllergens: row!.addAllergens as ProductAllergens | null,
  };
}

/** A group's items (active AND inactive), for the authoring editor. Ordered by `sort` then `id`. */
export async function listOptionGroupItems(
  tx: Transaction,
  groupId: string,
): Promise<OptionGroupItem[]> {
  const rows = await tx
    .select(OPTION_GROUP_ITEM_COLUMNS)
    .from(optionGroupItems)
    .where(eq(optionGroupItems.groupId, groupId))
    .orderBy(asc(optionGroupItems.sort), asc(optionGroupItems.id));
  return rows.map((r) => ({
    ...r,
    vatClass: r.vatClass as VatClass | null,
    addAllergens: r.addAllergens as ProductAllergens | null,
  }));
}

export async function updateOptionGroupItem(
  tx: Transaction,
  itemId: string,
  patch: UpdateOptionGroupItemInput,
): Promise<void> {
  await lockModifierDefinitions(tx);
  // maxQuantity's invariant is single-field: a patch that omits it leaves the stored value untouched
  // (Drizzle `.set()` only writes provided keys); a patch that sets it is re-validated here before the
  // write, the same clean-error-before-the-CHECK posture create takes.
  if (patch.maxQuantity !== undefined) validateOptionGroupItemMaxQuantity(patch.maxQuantity);
  // The allergen column is single-field: `normalizeOverlay` validates a present `addAllergens` and
  // collapses an empty map to NULL; Drizzle `.set()` writes only the keys present, so an omitted
  // `addAllergens` leaves the stored value untouched. Validated regardless of caller (CLAUDE.md §3).
  const write: Record<string, unknown> = { ...patch, ...(normalizeOverlay(patch) ?? {}) };
  await tx.update(optionGroupItems).set(write).where(eq(optionGroupItems.id, itemId));
}

/**
 * Fully replace the product's option groups with `groupIds`. Delete the existing attachments,
 * then insert each id with `sort` equal to its list index; an empty list detaches everything.
 * The caller's transaction keeps replacement atomic, and the foreign keys reject a product or
 * group reference that names no row.
 */
export async function setProductOptionGroups(
  tx: Transaction,
  productId: string,
  groupIds: string[],
): Promise<void> {
  await lockModifierDefinitions(tx);
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new AppError("product.not_found", { productId });
  if (groupIds.length) {
    const retained = await tx
      .select({ id: productOptionGroups.groupId })
      .from(productOptionGroups)
      .where(eq(productOptionGroups.productId, productId));
    const available = await tx
      .select({ id: optionGroups.id, active: optionGroups.active })
      .from(optionGroups)
      .where(inArray(optionGroups.id, groupIds));
    if (
      available.some(
        (group) => !group.active && !retained.some((entry) => entry.id === group.id),
      ) ||
      available.length !== groupIds.length ||
      new Set(groupIds).size !== groupIds.length
    )
      throw new AppError("modifier.invalid", { field: "modifierIds" });
  }
  await tx.delete(productOptionGroups).where(eq(productOptionGroups.productId, productId));
  if (groupIds.length === 0) return;
  await tx.insert(productOptionGroups).values(
    groupIds.map((groupId, index) => ({
      productId,
      groupId,
      sort: index,
    })),
  );
}

/** The option group ids attached to a product, in per-attachment `sort` order — the read-back the
 * product form (Task 12) uses to show which groups are attached and in what order. */
export async function listProductOptionGroupIds(
  tx: Transaction,
  productId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ groupId: productOptionGroups.groupId })
    .from(productOptionGroups)
    .where(eq(productOptionGroups.productId, productId))
    .orderBy(asc(productOptionGroups.sort), asc(productOptionGroups.groupId));
  return rows.map((r) => r.groupId);
}
