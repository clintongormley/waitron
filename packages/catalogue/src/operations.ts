import { isDeepStrictEqual } from "node:util";
import { readOfferedModifiers } from "./offered-modifiers.js";
import { readProductModifiers } from "./product-modifiers.js";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  AppError,
  centsToDecimal,
  resolveContentText,
  FALLBACK_LOCALE,
  stringToCents,
} from "@waitron/shared";
import { catalogues, categories, locationCatalogues, locations, now, products } from "@waitron/db";
import { productLabels } from "./schema/labels.js";
import { readContentLanguages } from "./content-languages.js";
import { setMainReportingCategory } from "./categories.js";
import { labelIdArray } from "./labels.js";
export { createCategory, listCategories, updateCategory } from "./categories.js";
export type { Category } from "./categories.js";
import type { Transaction } from "@waitron/db";
import "./errors.js"; // load the code registry for the `catalogue.*`/`product.*`/`menu_*` codes thrown below
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
import { contentLanguages, menuItems, menuSections } from "./schema/menu.js";
import { productUnits, units } from "./schema/units.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { priceOrNull, resolveOfferPrice } from "./offer-price.js";
import { assertNotOfferedAsExtra } from "./variants.js";
import {
  assignProductUnit,
  clearProductUnit,
  EACH_UNIT,
  getSeededUnit,
  getSellableUnit,
  type SellableUnit,
} from "./units.js";
import { validateDietaryDeclarations, type DietaryLabel } from "./dietary-declarations.js";
import {
  clearedPricingUnit,
  effectiveProductColumns as effective,
  isTopLevelProduct,
  labelOwnerJoin,
  parentJoin,
  parentProducts,
  productWithId,
  unitOwnerJoin,
} from "./variant-fallback.js";
import type { ListedVariant, Product } from "./product-types.js";
import type {
  AccessibleCatalogue,
  AvailableProduct,
  MenuItem,
  MenuOffer,
  MenuOfferVariant,
} from "./menu-types.js";
export type {
  AccessibleCatalogue,
  AvailableProduct,
  MenuItem,
  MenuOffer,
  MenuOfferVariant,
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedModifier,
  OfferedOptionsList,
} from "./menu-types.js";
export type { ListedVariant, Product } from "./product-types.js";

/**
 * Deactivation is `active = false`, never DELETE: a product may sit behind historical sale-line
 * snapshots.
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
  /** `null` = Each (no `product_units` row stored); a real id assigns that unit; omitted falls back
   * to the legacy `pricingUnit`. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  /** Omitted leaves it null (unreviewed). */
  allergens?: ProductAllergens;
  /** The staff diet override. Omitted or `null` leaves no override. */
  dietOverride?: DietOverride | null;
  /** A stored photo reference (`<sha256>.<ext>`); omitted leaves it null (no picture). */
  image?: string;
  /** Omitted leaves it active. */
  active?: boolean;
  /** Omitted leaves it available. */
  available?: boolean;
  /** Omitted leaves it offered standalone. */
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
  /** `null` is a variant's blank, read as its parent's; `products_top_level_owns_ck` refuses it on a
   * product with no parent, as it does a blank `vatClass` and `dietaryDeclarations`. */
  unitPrice?: string | null;
  vatClass?: VatClass | null;
  /** `null` clears the unit (the product then reads as Each, and a variant as its parent's unit); a
   * real id sets it; omitted leaves it unchanged unless the legacy `pricingUnit` is supplied. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  categoryId?: string | null;
  /** `null` clears the declaration back to unreviewed. */
  allergens?: ProductAllergens | null;
  /** `null` clears the staff diet override; published `diet` reverts to the recipe-derived
   * profile. */
  dietOverride?: DietOverride | null;
  image?: string | null;
  active?: boolean;
  /** `false` is "sold out for now". */
  available?: boolean;
  /** Whether the product is offered standalone. */
  soldAlone?: boolean;
  description?: Record<string, string> | null;
  kitchenName?: string | null;
  dietaryDeclarations?: DietaryLabel[] | null;
}

const CATALOGUE_COLUMNS = {
  id: catalogues.id,
  name: catalogues.name,
  active: catalogues.active,
  version: catalogues.version,
};

/** A product's own identity and names, and its EFFECTIVE inherited values: a query selecting these
 * has `.leftJoin(parentProducts, parentJoin)` (`variant-fallback.ts`). */
const PRODUCT_BASE_COLUMNS = {
  id: products.id,
  catalogueId: products.catalogueId,
  categoryId: effective.categoryId,
  name: products.name,
  customerName: products.customerName,
  soldAlone: products.soldAlone,
  pricingUnit: effective.pricingUnit,
  unitPrice: effective.unitPrice,
  vatClass: effective.vatClass,
  active: products.active,
  available: products.available,
  allergens: effective.allergens,
  manualAllergens: effective.manualAllergens,
  dietOverride: effective.dietOverride,
  image: effective.image,
  description: effective.description,
  kitchenName: products.kitchenName,
  dietaryDeclarations: effective.dietaryDeclarations,
};

const PRODUCT_COLUMNS = {
  ...PRODUCT_BASE_COLUMNS,
  unitId: units.id,
  unitName: units.name,
  unitAbbreviation: units.abbreviation,
  unitPrecision: units.precision,
  hardwareUnit: units.hardwareUnit,
};

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
  /** Cents, as the column stores it; `toProduct` is where it becomes the amount callers see. */
  unitPrice: number;
  vatClass: string;
  active: boolean;
  available: boolean;
  allergens: ProductAllergens | null;
  manualAllergens: ProductAllergens | null;
  // Looser than {@link DietOverride}; `toProduct` narrows it, relying on the write-side
  // `validateDietOverride`.
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

// `pricing_unit`/`vat_class` are constrained to their unions by a CHECK (catalogue.ts), which is
// what makes the casts below safe.
function toProduct(row: RawProduct, labelIds: string[], variants: ListedVariant[] = []): Product {
  const { unitName, unitAbbreviation, unitPrecision, hardwareUnit, ...product } = row;
  const unit = sellableUnit(row.unitId, unitName, unitPrecision, hardwareUnit, unitAbbreviation);
  return {
    ...product,
    unitPrice: centsToDecimal(row.unitPrice),
    labelIds,
    primaryCategoryId: row.categoryId,
    modifiers: [],
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
    grossPrice: string | null;
    displayOrder?: number;
  },
): Promise<MenuItem> {
  const [product] = await tx
    .select({ parentId: products.parentId })
    .from(products)
    .where(eq(products.id, input.productId));
  if (product === undefined)
    throw new AppError("product.not_found", { productId: input.productId });
  // A variant follows its parent onto every menu (spec §15.5) and never has a menu row of its own.
  if (product.parentId !== null)
    throw new AppError("menu_item.variant_not_allowed", { productId: input.productId });
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
  const grossPrice = input.grossPrice === null ? null : stringToCents(input.grossPrice);
  const [written] = await tx
    .insert(menuItems)
    .values({ ...input, grossPrice })
    .onConflictDoUpdate({
      target: [menuItems.menuId, menuItems.productId],
      set: {
        sectionId: input.sectionId,
        grossPrice,
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
  return { ...written!, grossPrice: priceOrNull(written!.grossPrice) };
}

export async function updateMenuItem(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  patch: { sectionId?: string; grossPrice?: string | null; displayOrder?: number },
): Promise<void> {
  const { grossPrice, ...rest } = patch;
  const [row] = await tx
    .update(menuItems)
    .set({
      ...rest,
      ...(grossPrice === undefined
        ? {}
        : { grossPrice: grossPrice === null ? null : stringToCents(grossPrice) }),
    })
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

/**
 * What an offer and each of its variants both carry beyond their names and prices, as one column
 * set and one mapping, so a field added here reaches both. A query selecting these must
 * also have `.leftJoin(parentProducts, parentJoin)`, `.leftJoin(productUnits, unitOwnerJoin)`,
 * `.leftJoin(units, …)` and `.leftJoin(categories, …)`.
 */
const offerLineColumns = {
  unitId: units.id,
  unitName: units.name,
  unitAbbreviation: units.abbreviation,
  unitPrecision: units.precision,
  hardwareUnit: units.hardwareUnit,
  pricingUnit: effective.pricingUnit,
  vatClass: effective.vatClass,
  category: categories.name,
  allergens: effective.allergens,
  diet: effective.diet,
  dietDerivation: effective.dietDerivation,
  dietOverride: effective.dietOverride,
  dietaryDeclarations: effective.dietaryDeclarations,
  courseId: effective.courseId,
};

type ProductRow = typeof products.$inferSelect;
type UnitRow = typeof units.$inferSelect;

/** A row selecting {@link offerLineColumns}; the unit and category are LEFT-joined, so nullable. */
interface OfferLineRow {
  unitId: UnitRow["id"] | null;
  unitName: UnitRow["name"] | null;
  unitAbbreviation: UnitRow["abbreviation"] | null;
  unitPrecision: UnitRow["precision"] | null;
  hardwareUnit: UnitRow["hardwareUnit"] | null;
  pricingUnit: NonNullable<ProductRow["pricingUnit"]>;
  vatClass: NonNullable<ProductRow["vatClass"]>;
  category: (typeof categories.$inferSelect)["name"] | null;
  allergens: ProductRow["allergens"];
  diet: ProductRow["diet"];
  dietDerivation: ProductRow["dietDerivation"];
  dietOverride: ProductRow["dietOverride"];
  dietaryDeclarations: NonNullable<ProductRow["dietaryDeclarations"]>;
  courseId: ProductRow["courseId"];
}

function offerLineValues(row: OfferLineRow, defaultLanguage: string) {
  return {
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
        : resolveContentText(row.category, defaultLanguage, defaultLanguage),
    allergens: row.allergens,
    diet: row.diet as DietProfile | null,
    dietDerivation: row.dietDerivation as DietDerivation | null,
    dietOverride: row.dietOverride as DietOverride | null,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
    courseId: row.courseId,
  };
}

/**
 * The Active offers on the given menus. Unavailable (sold-out) products are left out unless the
 * caller is a management read passing `includeUnavailable`: spec §15.6 lets Available hide an item
 * from the till, never from the dashboard. Only a top-level product is an offer; each Active
 * variant of it is nested under its offer, an Unavailable one listed as unavailable.
 */
export async function listMenuOffers(
  tx: Transaction,
  menuIds: string[],
  options: { includeUnavailable?: boolean } = {},
): Promise<MenuOffer[]> {
  if (menuIds.length === 0) return [];
  const rows = await tx
    .select({
      id: menuItems.id,
      menuId: menuItems.menuId,
      productId: menuItems.productId,
      sectionId: menuItems.sectionId,
      grossPrice: menuItems.grossPrice,
      productPrice: products.unitPrice,
      displayOrder: menuItems.displayOrder,
      active: menuItems.active,
      menuName: catalogues.name,
      sectionName: menuSections.name,
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
      ...offerLineColumns,
    })
    .from(menuItems)
    .innerJoin(catalogues, eq(catalogues.id, menuItems.menuId))
    .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
    .innerJoin(products, eq(products.id, menuItems.productId))
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(categories, eq(categories.id, effective.categoryId))
    .where(
      and(
        inArray(menuItems.menuId, menuIds),
        eq(menuItems.active, true),
        eq(menuSections.active, true),
        eq(catalogues.active, true),
        isTopLevelProduct,
        eq(products.active, true),
        options.includeUnavailable === true ? undefined : eq(products.available, true),
      ),
    )
    .orderBy(catalogues.name, menuSections.displayOrder, menuItems.displayOrder, menuItems.id);
  if (rows.length === 0) return [];
  const content = await readContentLanguages(tx, FALLBACK_LOCALE);
  // The extras/options walk, keyed by MENU-ITEM id: on an offer each extras list is the version
  // this offer publishes (spec §3.2), while the order stays the product's own.
  const offeredByItem = await readOfferedModifiers(
    tx,
    rows.map((row) => ({ productId: row.productId, menuItemId: row.id })),
  );
  const variantsByItem = await readOfferVariants(
    tx,
    rows.map((row) => row.id),
    content.defaultLanguage,
  );
  return rows.map((row) => ({
    id: row.id,
    menuId: row.menuId,
    productId: row.productId,
    sectionId: row.sectionId,
    grossPrice: priceOrNull(row.grossPrice),
    unitPrice: resolveOfferPrice({
      variantMenuPrice: null,
      variantPrice: null,
      parentMenuPrice: priceOrNull(row.grossPrice),
      // Only a top-level product is an offer, so `products_top_level_owns_ck` sets its price.
      parentPrice: centsToDecimal(row.productPrice!),
    }),
    displayOrder: row.displayOrder,
    active: row.active,
    menuName: row.menuName,
    sectionName: row.sectionName,
    name: row.name,
    customerName: row.customerName,
    kitchenName: row.kitchenName,
    ...offerLineValues(row, content.defaultLanguage),
    offeredModifiers: offeredByItem.get(row.id) ?? [],
    variants: variantsByItem.get(row.id) ?? [],
  }));
}

/**
 * The Active variants of each offer's product, keyed by menu-item id, in variant order: each with
 * its EFFECTIVE values (`variant-fallback.ts`), what this menu overrides for it, and the price the
 * chain in `offer-price.ts` resolves. ONE query however many offers.
 */
async function readOfferVariants(
  tx: Transaction,
  menuItemIds: readonly string[],
  defaultLanguage: string,
): Promise<Map<string, MenuOfferVariant[]>> {
  const rows = await tx
    .select({
      menuItemId: menuItems.id,
      id: products.id,
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
      image: effective.image,
      // RAW, not the effective price: a blank one must fall to the parent's MENU price.
      ownPrice: products.unitPrice,
      parentMenuPrice: menuItems.grossPrice,
      parentPrice: parentProducts.unitPrice,
      menuPrice: menuItemVariantOverrides.price,
      offered: menuItemVariantOverrides.offered,
      available: products.available,
      ...offerLineColumns,
    })
    .from(menuItems)
    .innerJoin(products, eq(products.parentId, menuItems.productId))
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(categories, eq(categories.id, effective.categoryId))
    .leftJoin(
      menuItemVariantOverrides,
      and(
        eq(menuItemVariantOverrides.menuItemId, menuItems.id),
        eq(menuItemVariantOverrides.variantId, products.id),
      ),
    )
    .where(and(inArray(menuItems.id, [...menuItemIds]), eq(products.active, true)))
    .orderBy(menuItems.id, products.variantOrder, products.id);
  const grouped = new Map<string, MenuOfferVariant[]>();
  for (const row of rows) {
    const offered = row.offered ?? true;
    const held = grouped.get(row.menuItemId) ?? [];
    held.push({
      id: row.id,
      name: row.name,
      customerName: row.customerName,
      kitchenName: row.kitchenName,
      image: row.image,
      unitPrice: resolveOfferPrice({
        variantMenuPrice: priceOrNull(row.menuPrice),
        variantPrice: priceOrNull(row.ownPrice),
        parentMenuPrice: priceOrNull(row.parentMenuPrice),
        // The parent of a variant is top-level, so `products_top_level_owns_ck` sets its price.
        parentPrice: centsToDecimal(row.parentPrice!),
      }),
      menuPrice: priceOrNull(row.menuPrice),
      offered,
      available: row.available && offered,
      ...offerLineValues(row, defaultLanguage),
    });
    grouped.set(row.menuItemId, held);
  }
  return grouped;
}

/**
 * Check an untrusted catalogue id before a location-menu write, so an absent catalogue produces
 * `catalogue.not_found` (404) instead of an opaque foreign-key failure.
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
    .set({ name, updatedAt: now() })
    .where(eq(catalogues.id, catalogueId))
    .returning({ id: catalogues.id });
  if (row === undefined) throw new AppError("catalogue.not_found", { catalogueId });
}

export async function deactivateCatalogue(tx: Transaction, id: string): Promise<void> {
  await tx.update(catalogues).set({ active: false, updatedAt: now() }).where(eq(catalogues.id, id));
}

/**
 * Republish the computed `allergens` and/or `diet` of product `id` and of each variant of it with an
 * overlay of its own for that column. A missing diet derivation folds as "no recipe": empty origins
 * but PENDING, so vegan and vegetarian read "unknown" rather than a positive claim.
 *
 * A variant both of whose overlays for a column are blank stores that column blank, so its read
 * falls back to the parent's published value rather than a copy the parent's next change would
 * leave stale. An id that names no row is a silent no-op.
 */
async function republishOverlays(
  tx: Transaction,
  id: string,
  columns: { allergens: boolean; diet: boolean },
): Promise<void> {
  const overridden = [
    ...(columns.allergens ? [products.manualAllergens, products.recipeDerivation] : []),
    ...(columns.diet ? [products.dietDerivation, products.dietOverride] : []),
  ].map((column) => isNotNull(column));
  const rows = await tx
    .select({
      id: products.id,
      parentId: products.parentId,
      allergens: products.allergens,
      diet: products.diet,
      ownManual: products.manualAllergens,
      ownRecipe: products.recipeDerivation,
      ownDietDerivation: products.dietDerivation,
      ownDietOverride: products.dietOverride,
      manual: effective.manualAllergens,
      recipe: effective.recipeDerivation,
      dietDerivation: effective.dietDerivation,
      dietOverride: effective.dietOverride,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(or(eq(products.id, id), and(eq(products.parentId, id), or(...overridden))));
  for (const row of rows) {
    const inherits = row.parentId !== null;
    const changed: { allergens?: ProductAllergens | null; diet?: typeof row.diet } = {};
    if (columns.allergens) {
      const allergens =
        inherits && row.ownManual === null && row.ownRecipe === null
          ? null
          : republish(row.manual, row.recipe);
      if (!isDeepStrictEqual(allergens, row.allergens)) changed.allergens = allergens;
    }
    if (columns.diet) {
      const diet =
        inherits && row.ownDietDerivation === null && row.ownDietOverride === null
          ? null
          : overlayDietProfile(
              deriveDietProfile(
                (row.dietDerivation ?? { origins: [], pending: true }) as DietDerivation,
              ),
              row.dietOverride as DietOverride | null,
            );
      if (!isDeepStrictEqual(diet, row.diet)) changed.diet = diet;
    }
    if (Object.keys(changed).length > 0)
      await tx.update(products).set(changed).where(eq(products.id, row.id));
  }
}

/**
 * A variant has no recipe of its own (`setProductRecipe`, packages/recipes/src/recipes.ts, refuses
 * one), so a variant's id is refused as an id naming no product. An id naming no row at all is a
 * silent no-op.
 */
async function applyDerivation(
  tx: Transaction,
  productId: string,
  derivation:
    { recipeDerivation: RecipeDerivation | null } | { dietDerivation: DietDerivation | null },
  columns: { allergens: boolean; diet: boolean },
): Promise<void> {
  const [written] = await tx
    .update(products)
    .set({ ...derivation, updatedAt: now() })
    .where(productWithId(productId, "top-level"))
    .returning({ id: products.id });
  if (written === undefined) {
    const [row] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId));
    if (row !== undefined) throw new AppError("product.not_found", { productId });
    return;
  }
  await republishOverlays(tx, productId, columns);
}

/**
 * Set a product's recipe-derived overlay and republish its declaration, and that of each variant
 * that sets its own allergens. The seam `@waitron/recipes` calls when a recipe or its ingredients
 * change; `null` clears the derivation (no recipe), after which the published declaration reverts to
 * the manual overlay alone.
 */
export async function applyRecipeDerivation(
  tx: Transaction,
  productId: string,
  derivation: RecipeDerivation | null,
): Promise<void> {
  await applyDerivation(
    tx,
    productId,
    { recipeDerivation: derivation },
    { allergens: true, diet: false },
  );
}

/**
 * Set a product's recipe-derived diet overlay and republish its diet profile, and that of each
 * variant that sets its own diet — the diet twin of {@link applyRecipeDerivation}. `null` clears the
 * derivation (no recipe), after which the published profile reverts to the override overlaid on the
 * empty, PENDING derived profile.
 */
export async function applyDietDerivation(
  tx: Transaction,
  productId: string,
  derivation: DietDerivation | null,
): Promise<void> {
  await applyDerivation(
    tx,
    productId,
    { dietDerivation: derivation },
    { allergens: false, diet: true },
  );
}

export async function createProduct(tx: Transaction, input: CreateProductInput): Promise<Product> {
  if (input.unitId === undefined && input.pricingUnit === undefined) {
    throw new AppError("product.invalid", { field: "unitId" });
  }
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
  // Created top-level with no recipe, so the published values are the two staff overlays over empty
  // derivations — computed as `republishOverlays` would.
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
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
      unitPrice: stringToCents(input.unitPrice),
      vatClass: input.vatClass,
      active: input.active ?? true,
      available: input.available ?? true,
      soldAlone: input.soldAlone ?? true,
      manualAllergens: allergens,
      allergens: republish(allergens, null),
      dietOverride,
      diet: overlayDietProfile(deriveDietProfile({ origins: [], pending: true }), dietOverride),
      image: input.image ?? null,
    })
    .returning({ id: products.id });
  if (selectedUnit !== null) await assignProductUnit(tx, row!.id, selectedUnit.id);
  if (input.categoryId !== null) await setMainReportingCategory(tx, row!.id, input.categoryId);
  const [created] = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(eq(products.id, row!.id));
  // Created just now, so it carries no labels yet.
  return toProduct(created!, []);
}

export async function listProducts(tx: Transaction, catalogueId?: string): Promise<Product[]> {
  const rows = await tx
    .select({
      ...PRODUCT_COLUMNS,
      labelIds: labelIdArray,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(productLabels, labelOwnerJoin)
    .where(
      and(
        isTopLevelProduct,
        catalogueId === undefined ? undefined : eq(products.catalogueId, catalogueId),
      ),
    )
    .groupBy(products.id, units.id)
    .orderBy(products.createdAt, products.id);
  if (rows.length === 0) return [];
  const modifiers = await readProductModifiers(
    tx,
    rows.map((row) => row.id),
  );
  // A variant is listed under its parent, never on its own; Inactive ones too, for the dashboard.
  const variantsByProduct = await listedVariantsOfProducts(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...toProduct(row, row.labelIds, variantsByProduct.get(row.id) ?? []),
    modifiers: modifiers.get(row.id) ?? [],
  }));
}

/** Every variant of each product in `productIds`, Inactive ones included, in variant order, with
 * the values it carries once its blanks read as its parent's. */
async function listedVariantsOfProducts(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, ListedVariant[]>> {
  const rows = await tx
    .select({
      parentId: products.parentId,
      id: products.id,
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
      image: products.image,
      ownPrice: products.unitPrice,
      available: products.available,
      active: products.active,
      unitPrice: effective.unitPrice,
      vatClass: effective.vatClass,
      primaryCategoryId: effective.categoryId,
      labelIds: labelIdArray,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productLabels, labelOwnerJoin)
    .where(inArray(products.parentId, [...productIds]))
    .groupBy(products.id)
    .orderBy(products.parentId, products.variantOrder, products.id);
  const grouped = new Map<string, ListedVariant[]>();
  for (const {
    parentId,
    ownPrice,
    unitPrice,
    vatClass,
    primaryCategoryId,
    labelIds,
    ...row
  } of rows) {
    const held = grouped.get(parentId!) ?? [];
    held.push({
      ...row,
      unitPrice: priceOrNull(ownPrice),
      effective: {
        unitPrice: centsToDecimal(unitPrice),
        vatClass: vatClass as VatClass,
        primaryCategoryId,
        labelIds,
      },
    });
    grouped.set(parentId!, held);
  }
  return grouped;
}

export async function updateProduct(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
): Promise<void> {
  if (patch.active === true) {
    const [row] = await tx
      .select({ parentId: products.parentId })
      .from(products)
      .where(eq(products.id, id));
    if (row?.parentId != null) await assertNotOfferedAsExtra(tx, row.parentId, "active");
  }
  // `allergens` and `dietOverride` are the staff overlays, not the published columns.
  const {
    allergens,
    dietOverride,
    dietaryDeclarations,
    categoryId,
    unitId,
    pricingUnit,
    unitPrice,
    ...rest
  } = patch;
  if (categoryId !== undefined) await setMainReportingCategory(tx, id, categoryId);
  if (allergens != null) validateAllergens(allergens);
  if (dietOverride !== undefined) validateDietOverride(dietOverride);
  const directDietary =
    dietaryDeclarations === undefined || dietaryDeclarations === null
      ? dietaryDeclarations
      : validateDietaryDeclarations(dietaryDeclarations);
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
      ...(unitPrice === undefined
        ? {}
        : { unitPrice: unitPrice === null ? null : stringToCents(unitPrice) }),
      ...(unitAction.kind === "keep"
        ? {}
        : {
            pricingUnit:
              unitAction.kind === "clear"
                ? clearedPricingUnit()
                : legacyPricingUnit(unitAction.unit),
          }),
      ...(allergens !== undefined ? { manualAllergens: allergens } : {}),
      ...(dietOverride !== undefined ? { dietOverride } : {}),
      ...(directDietary === undefined ? {} : { dietaryDeclarations: directDietary }),
      updatedAt: now(),
    })
    .where(eq(products.id, id));
  if (unitAction.kind === "set") await assignProductUnit(tx, id, unitAction.unit.id);
  else if (unitAction.kind === "clear") await clearProductUnit(tx, id);
  // Republish only the columns whose overlay changed: an unrelated edit leaves both as they are.
  if (allergens !== undefined || dietOverride !== undefined)
    await republishOverlays(tx, id, {
      allergens: allergens !== undefined,
      diet: dietOverride !== undefined,
    });
}

export async function deactivateProduct(tx: Transaction, id: string): Promise<void> {
  await tx.update(products).set({ active: false, updatedAt: now() }).where(eq(products.id, id));
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
 * default in the location's menu list: it is demoted to a `location_catalogues` member rather than
 * dropped, so membership and the default stay independent. A location with no prior default (or one
 * already set to `catalogueId`) skips the demote. The redundant member row `catalogueId` may
 * already hold is left untouched — {@link resolveAccessibleCatalogueIds} de-duplicates, so it is
 * invisible.
 */
export async function setLocationDefaultCatalogue(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
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
 * Attach a NON-default catalogue to a location's accessible set (a `location_catalogues` row).
 * Idempotent: the primary key (location_id, catalogue_id) makes a re-attach a no-op.
 */
export async function addCatalogueToLocation(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
  await tx.insert(locationCatalogues).values({ locationId, catalogueId }).onConflictDoNothing();
}

/**
 * Detach a catalogue from a location's accessible set. NEVER touches the default
 * (`locations.catalogue_id`), which is not stored as a member row.
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
 * The catalogue ids in a location's menu list: its default unioned with every `location_catalogues`
 * member, de-duplicated. The order of `ids` is not meaningful. `invoiceLocales` is empty only when
 * the location does not exist.
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

/** A location's `invoice_locales`, or `[]` when there is no such location. */
export async function readInvoiceLocales(tx: Transaction, locationId: string): Promise<string[]> {
  const [row] = await tx
    .select({ invoiceLocales: locations.invoiceLocales })
    .from(locations)
    .where(eq(locations.id, locationId));
  return row?.invoiceLocales ?? [];
}

export interface LocationCatalogue extends Catalogue {
  /** In this location's accessible set — its default (`locations.catalogue_id`) OR a
   * `location_catalogues` member. */
  sellable: boolean;
  /** This location's default menu (`locations.catalogue_id`); always also `sellable`. */
  isDefault: boolean;
}

/**
 * EVERY catalogue, each flagged with whether it is in `locationId`'s menu list (`sellable`) and
 * whether it is that location's default (`isDefault`).
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

/** The active catalogues in `locationId`'s menu list, default first, then by name. */
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
 * The Active and Available products across `locationId`'s whole accessible catalogue set, grouped
 * by menu. `invoiceLocales` is `[]` ONLY when the location is missing, while `products` is also
 * `[]` for a real location with no accessible catalogue — the two emptiness conditions differ.
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
      pricingUnit: effective.pricingUnit,
      unitPrice: effective.unitPrice,
      vatClass: effective.vatClass,
      category: categories.name,
      categoryLanguage: contentLanguages.defaultLanguage,
      allergens: effective.allergens,
      diet: effective.diet,
      dietDerivation: effective.dietDerivation,
      dietOverride: effective.dietOverride,
      dietaryDeclarations: effective.dietaryDeclarations,
      courseId: effective.courseId,
      catalogueId: catalogues.id,
      catalogueName: catalogues.name,
    })
    .from(products)
    .innerJoin(catalogues, eq(catalogues.id, products.catalogueId))
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .leftJoin(categories, eq(categories.id, effective.categoryId))
    .leftJoin(contentLanguages, sql`true`)
    .where(
      and(
        inArray(catalogues.id, accessible),
        eq(catalogues.active, true),
        eq(products.active, true),
        eq(products.available, true),
        // A variant is sold only through its parent's menu offer, never as a product in its own
        // right: sold from here it would be filed under its own names as if it had no parent.
        isTopLevelProduct,
      ),
    )
    .orderBy(catalogues.name, products.createdAt, products.id);

  // No menu offer is in this read at all, so each extras list is the one the product itself
  // carries, priced without an offer's overrides (spec §3.3, minus the menu step).
  const offeredByProduct = await readOfferedModifiers(
    tx,
    rows.map((row) => ({ productId: row.id, menuItemId: null })),
  );

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
    unitPrice: centsToDecimal(row.unitPrice),
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
    offeredModifiers: offeredByProduct.get(row.id) ?? [],
  }));
  return { products: available, invoiceLocales };
}
