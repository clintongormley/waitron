import { combineOffer } from "./menu-combine.js";
import { includedMenus, placesOf } from "./menu-inclusion.js";
import { isDeepStrictEqual } from "node:util";
import { readOfferedModifiers } from "./offered-modifiers.js";
import { readProductModifiers } from "./product-modifiers.js";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { AppError, centsToDecimal, stringToCents, type Decimal } from "@waitron/shared";
import { catalogues, categories, locationCatalogues, locations, now, products } from "@waitron/db";
import { readCategory } from "./categories.js";
import { isStoredColor } from "./color-inheritance.js";
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
import type { PricingUnit } from "./pricing.js";
import type { ProductOrdering } from "./product-ordering.js";
import type { VatClass } from "./vat-rates.js";
import { menuItems } from "./schema/menu.js";
import { sections } from "./schema/sections.js";
import {
  createMenuShell,
  menuRoots,
  reachableMenuItem,
  requireMenuRoot,
} from "./menu-structure.js";
import { batches } from "./batches.js";
import { loadSectionGraph, placementsByProduct, type SectionGraph } from "./section-graph.js";
import { addMember, sectionPatchValues } from "./sections.js";
import { productUnits, units } from "./schema/units.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { priceOrNull, resolveOfferPrice } from "./offer-price.js";
import { assertNotOfferedAsExtra, menuVariantsOfItems } from "./variants.js";
import {
  assertFamilyNamesFree,
  assertUpdatedNamesFree,
  nameColumns,
  readUpdatedName,
} from "./product-names.js";
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
  MenuPriceRow,
} from "./menu-types.js";
export type {
  AccessibleCatalogue,
  AvailableProduct,
  MenuItem,
  MenuOffer,
  MenuOfferVariant,
  MenuPriceRow,
  MenuPriceVariant,
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
  /** Omitted leaves it `public`. */
  ordering?: ProductOrdering;
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
  /** `null` clears the unit (a product then reads as Each); a real id sets it, on a product with no
   * parent only; omitted leaves it unchanged unless the legacy `pricingUnit` is supplied. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  categoryId?: string | null;
  /** `null` takes its category's colour. On a variant's id any value, null included, is refused
   * `product.not_found`: a variant's colour is always its parent's. */
  color?: string | null;
  /** `null` clears the declaration back to unreviewed. */
  allergens?: ProductAllergens | null;
  /** `null` clears the staff diet override; published `diet` reverts to the recipe-derived
   * profile. */
  dietOverride?: DietOverride | null;
  image?: string | null;
  active?: boolean;
  /** `false` is "sold out for now". */
  available?: boolean;
  /** Who may order the product on its own. */
  ordering?: ProductOrdering;
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
  color: effective.color,
  name: products.name,
  customerName: products.customerName,
  ordering: products.ordering,
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
  color: string | null;
  name: string;
  customerName: Record<string, string> | null;
  ordering: ProductOrdering;
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
function toProduct(row: RawProduct, variants: ListedVariant[] = []): Product {
  const { unitName, unitAbbreviation, unitPrecision, hardwareUnit, ...product } = row;
  const unit = sellableUnit(row.unitId, unitName, unitPrecision, hardwareUnit, unitAbbreviation);
  return {
    ...product,
    unitPrice: centsToDecimal(row.unitPrice),
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

/** A new menu, with the root and default home layout it owns (`createMenuShell`). */
export async function createCatalogue(
  tx: Transaction,
  input: {
    name: string;
    names?: Record<string, string>;
    image?: string | null;
    color?: string | null;
  },
): Promise<Catalogue> {
  const presentation = await sectionPatchValues(tx, {
    internalName: input.name,
    names: input.names,
    image: input.image,
    color: input.color,
  });
  const [row] = await tx
    .insert(catalogues)
    .values({ name: presentation.internalName! })
    .returning(CATALOGUE_COLUMNS);
  await createMenuShell(tx, row!.id, row!.name, presentation);
  return row!;
}

export async function listCatalogues(tx: Transaction): Promise<Catalogue[]> {
  return tx.select(CATALOGUE_COLUMNS).from(catalogues).orderBy(catalogues.createdAt, catalogues.id);
}

const MENU_ITEM_COLUMNS = {
  id: menuItems.id,
  menuId: menuItems.menuId,
  productId: menuItems.productId,
  grossPrice: menuItems.grossPrice,
};

/**
 * Puts a top-level product on the menu's top level, and sets the menu's price for it when
 * `grossPrice` is given. A product the menu already reaches elsewhere keeps its settings row.
 */
export async function addProductToMenu(
  tx: Transaction,
  input: { menuId: string; productId: string; grossPrice?: string | null },
): Promise<MenuItem> {
  const rootSectionId = await requireMenuRoot(tx, input.menuId);
  const [product] = await tx
    .select({ parentId: products.parentId })
    .from(products)
    .where(eq(products.id, input.productId));
  if (product === undefined)
    throw new AppError("product.not_found", { productId: input.productId });
  // A variant follows its parent onto every menu and never has a menu row of its own.
  if (product.parentId !== null)
    throw new AppError("menu_item.variant_not_allowed", { productId: input.productId });
  await addMember(tx, rootSectionId, { kind: "product", productId: input.productId });
  const [row] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.menuId, input.menuId), eq(menuItems.productId, input.productId)));
  // Just placed on the root, so reached: `updateMenuItem`'s reachability check would only repeat it.
  if (input.grossPrice !== undefined)
    await writeMenuItemSettings(tx, row!.id, { grossPrice: input.grossPrice });
  const [written] = await tx
    .select(MENU_ITEM_COLUMNS)
    .from(menuItems)
    .where(eq(menuItems.id, row!.id));
  return { ...written!, grossPrice: priceOrNull(written!.grossPrice) };
}

/** Sets the menu's price for a product it reaches. */
export async function updateMenuItem(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  patch: { grossPrice?: string | null },
): Promise<void> {
  if ((await reachableMenuItem(tx, menuItemId, menuId)) === undefined)
    throw new AppError("menu_item.not_found", { menuId, menuItemId });
  await writeMenuItemSettings(tx, menuItemId, patch);
}

async function writeMenuItemSettings(
  tx: Transaction,
  menuItemId: string,
  patch: { grossPrice?: string | null },
): Promise<void> {
  const { grossPrice } = patch;
  if (grossPrice !== undefined)
    await tx
      .update(menuItems)
      .set({ grossPrice: grossPrice === null ? null : stringToCents(grossPrice) })
      .where(eq(menuItems.id, menuItemId));
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

function offerLineValues(row: OfferLineRow) {
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
    category: row.category,
    allergens: row.allergens,
    diet: row.diet as DietProfile | null,
    dietDerivation: row.dietDerivation as DietDerivation | null,
    dietOverride: row.dietOverride as DietOverride | null,
    dietaryDeclarations: validateDietaryDeclarations(row.dietaryDeclarations),
    courseId: row.courseId,
  };
}

/**
 * The Active offers on the given menus: the products each menu's structure reaches, menus by name
 * and each in its structure's order (`reachableProducts`), Unavailable (sold-out) ones included.
 * Only a top-level product is an offer; each Active variant of it is nested under its offer, an
 * Unavailable one listed as unavailable.
 */
export async function listMenuOffers(
  tx: Transaction,
  menuIds: string[],
  options: OfferOptions = {},
): Promise<MenuOffer[]> {
  if (menuIds.length === 0) return [];
  const roots = await menuRoots(tx, menuIds);
  return offersOn(tx, roots, options.graph ?? (await loadSectionGraph(tx)), options);
}

interface OfferOptions {
  /** Every option label, and every extras item whose product is Active and has no Active variant,
   * whatever its availability: what a published document holds. */
  includeEveryModifierItem?: boolean;
  /** The graph the caller has already loaded for this operation. */
  graph?: SectionGraph;
}

/** The rows `offersOn` builds each offer from, in its order, and the paths placing each row's
 * product. */
async function offerRowsOn(
  tx: Transaction,
  roots: ReadonlyMap<string, string>,
  graph: SectionGraph,
  includeInactive = false,
) {
  // Keyed in the order `reachableProducts` gives, so a key's position is its rank on the menu.
  const placed = new Map(
    [...roots].map(([menuId, rootSectionId]) => [
      menuId,
      placementsByProduct(graph, rootSectionId),
    ]),
  );
  const placementsOf = (row: { menuId: string; productId: string }): string[][] =>
    placed
      .get(row.menuId)!
      .get(row.productId)!
      .map((path) => path.slice(1));
  const rankOf = new Map(
    [...placed].map(([menuId, paths]) => [
      menuId,
      new Map([...paths.keys()].map((productId, rank) => [productId, rank])),
    ]),
  );
  const reached = [...new Set([...placed.values()].flatMap((paths) => [...paths.keys()]))];
  const menuIds = [...roots.keys()];
  const rows = [];
  for (const batch of batches(reached))
    rows.push(
      ...(await tx
        .select({
          id: menuItems.id,
          menuId: menuItems.menuId,
          productId: menuItems.productId,
          grossPrice: menuItems.grossPrice,
          productPrice: products.unitPrice,
          categoryId: products.categoryId,
          menuName: catalogues.name,
          name: products.name,
          customerName: products.customerName,
          kitchenName: products.kitchenName,
          ordering: products.ordering,
          active: products.active,
          ...offerLineColumns,
        })
        .from(menuItems)
        .innerJoin(catalogues, eq(catalogues.id, menuItems.menuId))
        .innerJoin(products, eq(products.id, menuItems.productId))
        .leftJoin(parentProducts, parentJoin)
        .leftJoin(productUnits, unitOwnerJoin)
        .leftJoin(units, eq(units.id, productUnits.unitId))
        .leftJoin(categories, eq(categories.id, effective.categoryId))
        .where(
          and(
            inArray(menuItems.menuId, menuIds),
            inArray(menuItems.productId, batch),
            eq(catalogues.active, true),
            isTopLevelProduct,
            includeInactive ? undefined : eq(products.active, true),
          ),
        )),
    );
  const offered = rows.filter((row) => rankOf.get(row.menuId)!.has(row.productId));
  const menuOrder = new Map(
    roots.size > 1 && offered.length > 1
      ? (
          await tx
            .select({ id: catalogues.id })
            .from(catalogues)
            .where(inArray(catalogues.id, menuIds))
            .orderBy(catalogues.name, catalogues.id)
        ).map((row, index) => [row.id, index])
      : menuIds.map((id) => [id, 0]),
  );
  offered.sort(
    (a, b) =>
      menuOrder.get(a.menuId)! - menuOrder.get(b.menuId)! ||
      rankOf.get(a.menuId)!.get(a.productId)! - rankOf.get(b.menuId)!.get(b.productId)!,
  );
  return { rows: offered, placementsOf };
}

/** An offer row's prices. Only a top-level product is an offer, so `products_top_level_owns_ck`
 * sets `productPrice`. */
function offerPrices(row: { grossPrice: number | null; productPrice: number | null }) {
  const override = priceOrNull(row.grossPrice);
  const productPrice = centsToDecimal(row.productPrice!);
  const unitPrice = resolveOfferPrice({
    variantMenuPrice: null,
    variantPrice: null,
    parentMenuPrice: override,
    parentPrice: productPrice,
  });
  return { override, unitPrice };
}

async function offersOn(
  tx: Transaction,
  roots: ReadonlyMap<string, string>,
  graph: SectionGraph,
  options: OfferOptions,
  /** Inactive products and variants too: the management prices read alone; a till's offer never
   * lists one. */
  includeInactive = false,
): Promise<MenuOffer[]> {
  const allRoots = new Map(roots);
  const include = (menuId: string): void => {
    for (const id of includedMenus(graph, menuId)) {
      if (allRoots.has(id)) continue;
      allRoots.set(id, graph.roots().find((root) => root.menuId === id)!.sectionId);
      include(id);
    }
  };
  for (const id of roots.keys()) include(id);
  const { rows: offered, placementsOf } = await offerRowsOn(tx, allRoots, graph, includeInactive);
  if (offered.length === 0) return [];
  const offeredByItem = await readOfferedModifiers(
    tx,
    offered.map((row) => ({ productId: row.productId, menuItemId: row.id })),
    { includeEveryModifierItem: options.includeEveryModifierItem === true },
  );
  const variantsByItem = await readOfferVariants(
    tx,
    offered.map((row) => row.id),
    includeInactive,
  );
  const raw = offered.map((row) => {
    const { override, unitPrice } = offerPrices(row);
    return {
      id: row.id,
      menuId: row.menuId,
      productId: row.productId,
      grossPrice: override,
      unitPrice,
      menuName: row.menuName,
      placements: placementsOf(row),
      name: row.name,
      customerName: row.customerName,
      kitchenName: row.kitchenName,
      ordering: row.ordering,
      ...offerLineValues(row),
      offeredModifiers: offeredByItem.get(row.id) ?? [],
      variants: variantsByItem.get(row.id) ?? [],
    };
  });

  const byMenu = new Map<string, Map<string, MenuOffer>>();
  const combine = (menuId: string): Map<string, MenuOffer> => {
    const held = byMenu.get(menuId);
    if (held !== undefined) return held;
    const result = new Map<string, MenuOffer>();
    byMenu.set(menuId, result);
    for (const id of includedMenus(graph, menuId)) combine(id);
    if (!graph.menu(menuId)?.active) return result;
    for (const offer of raw.filter((offer) => offer.menuId === menuId)) {
      const places = placesOf(graph, menuId, offer.productId);
      if (!places.own && places.via.length === 0) continue;
      const row = offered.find((row) => row.id === offer.id)!;
      const included = places.via.flatMap((id) => {
        const included = byMenu.get(id)!.get(offer.productId);
        return included === undefined
          ? []
          : [{ menuId: id, menuName: graph.menu(id)!.name, offer: included.combined }];
      });
      if (!places.own && included.length === 0) continue;
      const combined = combineOffer({
        productId: offer.productId,
        catalogue: {
          price: centsToDecimal(row.productPrice!),
          variants: offer.variants.map((v) => ({ variantId: v.id, price: v.cataloguePrice })),
        },
        own: {
          price: offer.grossPrice as Decimal | null,
          variants: offer.variants.map((v) => ({
            variantId: v.id,
            price: v.menuPrice as Decimal | null,
          })),
        },
        placedInOwnSections: places.own,
        included,
      });
      result.set(offer.productId, {
        ...offer,
        placements: offer.placements.filter((path) =>
          path.every(
            (id) => graph.role(id) !== "menu_root" || graph.menu(graph.ownerMenu(id)!)?.active,
          ),
        ),
        combined,
        unitPrice:
          combined.price.state === "decided"
            ? combined.price.value
            : centsToDecimal(row.productPrice!),
        variants: offer.variants.map(({ cataloguePrice, ...variant }) => {
          const decision = combined.variants.find((v) => v.variantId === variant.id)!;
          return {
            ...variant,
            unitPrice:
              decision.price.state === "decided"
                ? decision.price.value
                : (cataloguePrice ?? centsToDecimal(row.productPrice!)),
          };
        }),
      });
    }
    return result;
  };
  const result: MenuOffer[] = [];
  for (const id of [...roots.keys()].sort((a, b) => {
    const left = graph.menu(a)?.name ?? "";
    const right = graph.menu(b)?.name ?? "";
    return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0;
  }))
    result.push(...combine(id).values());
  return result;
}

/**
 * Every product the menu reaches, Active or not, once each in `listMenuOffers`' order, with its own
 * price and its combined decisions. Sold-out and Inactive ones are listed.
 */
export async function menuPrices(tx: Transaction, menuId: string): Promise<MenuPriceRow[]> {
  const rootSectionId = await requireMenuRoot(tx, menuId);
  const graph = await loadSectionGraph(tx);
  const roots = new Map([[menuId, rootSectionId]]);
  const combinedOffers = await offersOn(tx, roots, graph, {}, true);
  const combinedByProduct = new Map(combinedOffers.map((offer) => [offer.productId, offer]));
  const { rows } = await offerRowsOn(tx, roots, graph, true);
  if (rows.length === 0) return [];
  const variantsByItem = await menuVariantsOfItems(
    tx,
    rows.map((row) => row.id),
    true,
  );
  return rows
    .filter((row) => combinedByProduct.has(row.productId))
    .map((row) => {
      const combinedOffer = combinedByProduct.get(row.productId)!;
      const { override } = offerPrices(row);
      return {
        menuItemId: row.id,
        productId: row.productId,
        name: row.name,
        categoryId: row.categoryId,
        placements: combinedOffer.placements,
        override,
        effectivePrice: combinedOffer.unitPrice,
        combined: combinedOffer.combined,
        active: row.active,
        variants: variantsByItem.get(row.id) ?? [],
      };
    });
}

async function readOfferVariants(
  tx: Transaction,
  menuItemIds: readonly string[],
  includeInactive = false,
): Promise<Map<string, (MenuOfferVariant & { cataloguePrice: Decimal | null })[]>> {
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
    .where(
      and(
        inArray(menuItems.id, [...menuItemIds]),
        includeInactive ? undefined : eq(products.active, true),
      ),
    )
    .orderBy(menuItems.id, products.variantOrder, products.id);
  const grouped = new Map<string, (MenuOfferVariant & { cataloguePrice: Decimal | null })[]>();
  for (const row of rows) {
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
      cataloguePrice: priceOrNull(row.ownPrice) as Decimal | null,
      menuPrice: priceOrNull(row.menuPrice),
      available: row.available,
      ...offerLineValues(row),
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

export async function updateMenuDetails(
  tx: Transaction,
  catalogueId: string,
  patch: {
    name?: string;
    names?: Record<string, string>;
    image?: string | null;
    color?: string | null;
  },
): Promise<void> {
  const rootSectionId = await requireMenuRoot(tx, catalogueId);
  const presentation = await sectionPatchValues(tx, {
    internalName: patch.name,
    names: patch.names,
    image: patch.image,
    color: patch.color,
  });
  if (presentation.internalName !== undefined)
    await tx
      .update(catalogues)
      .set({ name: presentation.internalName, updatedAt: now() })
      .where(eq(catalogues.id, catalogueId));
  if (Object.keys(presentation).length > 0)
    await tx.update(sections).set(presentation).where(eq(sections.id, rootSectionId));
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
  return insertProduct(tx, input, true);
}

/**
 * {@link createProduct} without the unique-name check, for `saveProductEditor`, which checks every
 * name its whole save leaves before writing any of it. Left out of the package's exports
 * (`index.ts`).
 */
export async function createProductSkippingNameCheck(
  tx: Transaction,
  input: CreateProductInput,
): Promise<Product> {
  return insertProduct(tx, input, false);
}

async function insertProduct(
  tx: Transaction,
  input: CreateProductInput,
  checkNames: boolean,
): Promise<Product> {
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
  const values = {
    catalogueId: input.catalogueId,
    categoryId: input.categoryId,
    ...nameColumns(input.name),
    customerName: input.customerName ?? null,
    description: input.description ?? null,
    kitchenName: input.kitchenName?.trim() || null,
    dietaryDeclarations: validateDietaryDeclarations(input.dietaryDeclarations ?? []),
    pricingUnit: selectedUnit === null ? "each" : legacyPricingUnit(selectedUnit),
    unitPrice: stringToCents(input.unitPrice),
    vatClass: input.vatClass,
    active: input.active ?? true,
    available: input.available ?? true,
    ordering: input.ordering ?? "public",
    manualAllergens: allergens,
    allergens: republish(allergens, null),
    dietOverride,
    diet: overlayDietProfile(deriveDietProfile({ origins: [], pending: true }), dietOverride),
    image: input.image ?? null,
  };
  if (input.categoryId !== null) await readCategory(tx, input.categoryId);
  if (checkNames)
    await assertFamilyNamesFree(tx, null, { name: input.name, active: values.active }, []);
  const [row] = await tx.insert(products).values(values).returning({ id: products.id });
  if (selectedUnit !== null) await assignProductUnit(tx, row!.id, selectedUnit.id);
  const [created] = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(eq(products.id, row!.id));
  return toProduct(created!);
}

export async function listProducts(tx: Transaction, catalogueId?: string): Promise<Product[]> {
  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(
      and(
        isTopLevelProduct,
        catalogueId === undefined ? undefined : eq(products.catalogueId, catalogueId),
      ),
    )
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
    ...toProduct(row, variantsByProduct.get(row.id) ?? []),
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
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.parentId, [...productIds]))
    .orderBy(products.parentId, products.variantOrder, products.id);
  const grouped = new Map<string, ListedVariant[]>();
  for (const { parentId, ownPrice, unitPrice, vatClass, primaryCategoryId, ...row } of rows) {
    const held = grouped.get(parentId!) ?? [];
    held.push({
      ...row,
      unitPrice: priceOrNull(ownPrice),
      effective: {
        unitPrice: centsToDecimal(unitPrice),
        vatClass: vatClass as VatClass,
        primaryCategoryId,
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
  await patchProduct(tx, id, patch, true);
}

/** {@link updateProduct} without the unique-name check, for the reason
 * {@link createProductSkippingNameCheck} gives. Left out of the package's exports (`index.ts`). */
export async function updateProductSkippingNameCheck(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
): Promise<void> {
  await patchProduct(tx, id, patch, false);
}

async function patchProduct(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
  checkNames: boolean,
): Promise<void> {
  const namesChange = checkNames && (patch.name !== undefined || patch.active !== undefined);
  const row = patch.active === true || namesChange ? await readUpdatedName(tx, id) : undefined;
  if (patch.active === true && row?.parentId != null)
    await assertNotOfferedAsExtra(tx, row.parentId, "active");
  if (namesChange && row !== undefined)
    await assertUpdatedNamesFree(tx, row, { name: patch.name, active: patch.active });
  // `allergens` and `dietOverride` are the staff overlays, not the published columns.
  const {
    allergens,
    dietOverride,
    dietaryDeclarations,
    categoryId,
    color,
    unitId,
    pricingUnit,
    unitPrice,
    ...rest
  } = patch;
  const assertColor = () => {
    if (color != null && !isStoredColor(color))
      throw new AppError("product.invalid", { field: "color" });
  };
  // A category refusal outranks a malformed colour; with no category in the patch, the colour is
  // refused before the product is looked for.
  if (categoryId === undefined) assertColor();
  if (categoryId !== undefined || color !== undefined) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(productWithId(id, "top-level"));
    if (!product) throw new AppError("product.not_found", { productId: id });
  }
  if (categoryId != null) await readCategory(tx, categoryId);
  assertColor();
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
      ...(rest.name === undefined ? {} : nameColumns(rest.name)),
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
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(color === undefined ? {} : { color }),
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

/**
 * The language a location's receipts are filed and printed in — the FIRST of its saved
 * `invoice_locales` — together with the whole list, which a sale snapshots. Read inside the
 * caller's transaction, so a sale files the language its lines were keyed under.
 */
export async function readReceiptLanguage(
  tx: Transaction,
  locationId: string,
): Promise<{ locale: string; invoiceLocales: string[] }> {
  const invoiceLocales = await readInvoiceLocales(tx, locationId);
  const locale = invoiceLocales[0];
  // The column's CHECK holds one or two entries, so only a missing row leaves the list empty.
  if (locale === undefined) throw new Error(`readReceiptLanguage: no location ${locationId}`);
  return { locale, invoiceLocales };
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
  // carries, priced without an offer's overrides (the chain minus the menu step).
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
    category: row.category,
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
