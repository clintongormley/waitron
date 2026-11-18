import { productDeclarationValues } from "./product-declarations.js";
import { nameOf } from "./section-members.js";
import { combineOffer } from "./menu-combine.js";
import { includedMenus, placesOf } from "./menu-inclusion.js";
import { readOfferedModifiers } from "./offered-modifiers.js";
import { readProductModifiers } from "./product-modifiers.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  AppError,
  centsToDecimal,
  stringToCents,
  type Decimal,
  colorOrNull,
  validateAllergens,
  type ProductAllergens,
  UNDECLARED_DIET,
  overlayDietProfile,
  validateDietOverride,
  type DietOverride,
  validateDietaryDeclarations,
  type DietaryLabel,
  VAT_CLASSES,
} from "@waitron/shared";
import {
  menus,
  recordActivity,
  categories,
  menuItems,
  menuItemVariantOverrides,
  now,
  products,
  readVenueInvoiceLocales,
  sections,
  units,
} from "@waitron/db";
import { readCategory } from "./categories.js";
export { createCategory, listCategories, updateCategory } from "./categories.js";
export type { Category } from "./categories.js";
import type { Transaction } from "@waitron/db";
import "./errors.js"; // load the code registry for the `menu.*`/`product.*`/`menu_*` codes thrown below
import { publishedAllergens } from "./derivation.js";
import type {
  PricingUnit,
  ProductOrdering,
  VatClass,
  ListedVariant,
  Product,
  AvailableProduct,
  MenuItem,
  MenuOffer,
  MenuOfferVariant,
  MenuPriceRow,
  MenuKind,
} from "@waitron/shared";
import {
  createMenuShell,
  menuRoots,
  reachableMenuItem,
  requireMenuRoot,
} from "./menu-structure.js";
import { batches } from "./batches.js";
import { assertMenuNameFree } from "./menu-names.js";
import { loadSectionGraph, placementsByProduct, type SectionGraph } from "./section-graph.js";
import { addMember, sectionPatchValues } from "./sections.js";
import { archiveProducts } from "./archive.js";
import {
  refuseSetMenu,
  requireSetMenu,
  setMenuPriceCents,
  setMenuVatClass,
  touchSetMenu,
} from "./set-menus.js";
import { priceOrNull, resolveOfferPrice } from "./offer-price.js";
import { assertNotOfferedAsExtra, menuVariantsOfItems } from "./variants.js";
import { assertFamilyNamesFree, assertUpdatedNamesFree, readUpdatedName } from "./product-names.js";
import {
  assignProductUnit,
  clearProductUnit,
  EACH_UNIT,
  getSeededUnit,
  getSellableUnit,
  unitMeasure,
  type SellableUnit,
} from "./units.js";
import {
  effectiveProductColumns as effective,
  isTopLevelProduct,
  parentJoin,
  parentProducts,
  unitOwnerJoin,
} from "./variant-fallback.js";
export type {
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
} from "@waitron/shared";
export type { ListedVariant, Product } from "@waitron/shared";

/**
 * Deactivation is `active = false`, never DELETE: a product may sit behind historical sale-line
 * snapshots.
 */

export interface Menu {
  id: string;
  name: string;
  active: boolean;
  kind: MenuKind;
  setPrice: string | null;
  setVatClass: VatClass | null;
}

export interface CreateProductInput {
  categoryId: string | null;
  name: string;
  /** Customer-facing translated name; omitted or null falls back to `name`. */
  customerName?: Record<string, string> | null;
  /** `null` = Each (no stored unit); a real id assigns that unit; omitted falls back
   * to the legacy `pricingUnit`. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  /** Omitted or null leaves it empty. */
  takeawayVatClass?: VatClass | null;
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
  /** `null` empties it, on a product or a variant. */
  takeawayVatClass?: VatClass | null;
  /** `null` clears the unit (a product then reads as Each); a real id sets it, on a product with no
   * parent only; omitted leaves it unchanged unless the legacy `pricingUnit` is supplied. */
  unitId?: string | null;
  pricingUnit?: PricingUnit;
  categoryId?: string | null;
  /** `null` takes its category's colour, else the venue's default. On a variant's id any value,
   * null included, is refused `product.not_found`: a variant's colour is always its parent's. */
  color?: string | null;
  /** `null` clears the declaration back to unreviewed. */
  allergens?: ProductAllergens | null;

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

const MENU_COLUMNS = {
  id: menus.id,
  name: menus.name,
  active: menus.active,
  kind: menus.kind,
  setPrice: menus.setPrice,
  setVatClass: menus.setVatClass,
};

function menuSummary(row: Pick<typeof menus.$inferSelect, keyof Menu>): Menu {
  return {
    ...row,
    setPrice: priceOrNull(row.setPrice),
    setVatClass: row.setVatClass as VatClass | null,
  };
}

/** A product's own identity and names, and its EFFECTIVE inherited values: a query selecting these
 * has `.leftJoin(parentProducts, parentJoin)` (`variant-fallback.ts`). */
const PRODUCT_BASE_COLUMNS = {
  id: products.id,
  categoryId: effective.categoryId,
  color: effective.color,
  name: products.name,
  customerName: products.customerName,
  ordering: products.ordering,
  unitPrice: effective.unitPrice,
  vatClass: effective.vatClass,
  takeawayVatClass: products.takeawayVatClass,
  active: products.active,
  available: products.available,
  allergens: effective.allergens,
  dietOverride: effective.dietOverride,
  image: effective.image,
  description: effective.description,
  kitchenName: products.kitchenName,
  dietaryDeclarations: effective.dietaryDeclarations,
  courseId: effective.courseId,
};

const PRODUCT_COLUMNS = {
  ...PRODUCT_BASE_COLUMNS,
  unitId: units.id,
  unitName: units.name,
  unitStaffName: units.staffName,
  unitStaffAbbreviation: units.staffAbbreviation,
  unitAbbreviation: units.abbreviation,
  unitPrecision: units.precision,
  hardwareUnit: units.hardwareUnit,
  unitMeasure: units.measure,
};

interface RawProduct {
  id: string;
  categoryId: string | null;
  color: string | null;
  name: string;
  customerName: Record<string, string> | null;
  ordering: ProductOrdering;
  unitId: string | null;
  unitName: Record<string, string> | null;
  unitStaffName: string | null;
  unitStaffAbbreviation: string | null;
  unitAbbreviation: Record<string, string> | null;
  unitPrecision: number | null;
  hardwareUnit: string | null;
  description: Record<string, string> | null;
  kitchenName: string | null;
  dietaryDeclarations: string[];
  /** Cents, as the column stores it; `toProduct` is where it becomes the amount callers see. */
  unitPrice: number;
  vatClass: string;
  takeawayVatClass: string | null;
  active: boolean;
  available: boolean;
  allergens: ProductAllergens | null;
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
  unitMeasure: boolean | null;
  courseId: string | null;
}

function toProduct(row: RawProduct, variants: ListedVariant[] = []): Product {
  const {
    unitName,
    unitAbbreviation,
    unitPrecision,
    hardwareUnit,
    unitMeasure,
    unitStaffName,
    unitStaffAbbreviation,
    ...product
  } = row;
  const unit = sellableUnit(
    row.unitId,
    unitName,
    unitPrecision,
    hardwareUnit,
    unitAbbreviation,
    unitStaffName,
    unitStaffAbbreviation,
    unitMeasure,
  );
  return {
    ...product,
    unitPrice: centsToDecimal(row.unitPrice),
    diet: overlayDietProfile(UNDECLARED_DIET, row.dietOverride as DietOverride | null),
    primaryCategoryId: row.categoryId,
    modifiers: [],
    unit,
    unitId: unit.id,
    pricingUnit: (row.hardwareUnit === null ? "each" : "weight") as PricingUnit,
    vatClass: row.vatClass as VatClass,
    takeawayVatClass: row.takeawayVatClass as VatClass | null,
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
  staffName: string | null,
  staffAbbreviation: string | null,
  measure: boolean | null,
): SellableUnit {
  if (id !== null && name !== null && precision !== null) {
    return {
      id,
      staffName: staffName!,
      staffAbbreviation: staffAbbreviation!,
      name,
      precision,
      abbreviation: abbreviation ?? {},
      hardwareUnit: hardwareUnit as SellableUnit["hardwareUnit"],
      ...unitMeasure(measure ?? false),
    };
  }
  // A product with no stored unit reads as Each (never stored).
  return EACH_UNIT;
}

/** A new menu, with the root and Device Home Page section it owns (`createMenuShell`). */
export async function createMenu(
  tx: Transaction,
  input: {
    name: string;
    names?: Record<string, string>;
    image?: string | null;
    color?: string | null;
    kind?: MenuKind;
    setPrice?: string | null;
    setVatClass?: VatClass | null;
  },
): Promise<Menu> {
  const presentation = await sectionPatchValues(tx, {
    internalName: input.name,
    names: input.names,
    image: input.image,
    color: input.color,
  });
  const terms =
    input.kind === "set_menu"
      ? {
          kind: input.kind,
          setPrice: setMenuPriceCents(input.setPrice),
          setVatClass: setMenuVatClass(input.setVatClass),
        }
      : undefined;
  const row = await insertMenu(tx, presentation.internalName!, terms);
  await createMenuShell(tx, row.id, presentation);
  return row;
}

/** The caller writes the menu's root and Home sections. */
export async function insertMenu(
  tx: Transaction,
  name: string,
  terms?: Pick<typeof menus.$inferInsert, "kind" | "setPrice" | "setVatClass">,
): Promise<Menu> {
  await assertMenuNameFree(tx, name);
  const [row] = await tx
    .insert(menus)
    .values({ name, ...terms })
    .returning(MENU_COLUMNS);
  return menuSummary(row!);
}

export async function listMenus(tx: Transaction): Promise<Menu[]> {
  return (await tx.select(MENU_COLUMNS).from(menus).orderBy(menus.createdAt, menus.id)).map(
    menuSummary,
  );
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
    await writeMenuItemSettings(tx, input.menuId, row!.id, { grossPrice: input.grossPrice });
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
  await writeMenuItemSettings(tx, menuId, menuItemId, patch);
}

async function writeMenuItemSettings(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  patch: { grossPrice?: string | null },
): Promise<void> {
  const { grossPrice } = patch;
  if (grossPrice === undefined) return;
  await tx
    .update(menuItems)
    .set({ grossPrice: grossPrice === null ? null : stringToCents(grossPrice) })
    .where(eq(menuItems.id, menuItemId));
  await touchSetMenu(tx, menuId);
}

/**
 * What an offer and each of its variants both carry beyond their names and prices, as one column
 * set and one mapping, so a field added here reaches both. A query selecting these must
 * also have `.leftJoin(parentProducts, parentJoin)`, `.leftJoin(units, unitOwnerJoin)`
 * and `.leftJoin(categories, …)`.
 */
const offerLineColumns = {
  unitId: units.id,
  unitName: units.name,
  unitStaffName: units.staffName,
  unitStaffAbbreviation: units.staffAbbreviation,
  unitAbbreviation: units.abbreviation,
  unitPrecision: units.precision,
  hardwareUnit: units.hardwareUnit,
  vatClass: effective.vatClass,
  takeawayVatClass: effective.takeawayVatClass,
  category: categories.name,
  allergens: effective.allergens,
  dietOverride: effective.dietOverride,
  dietaryDeclarations: effective.dietaryDeclarations,
  courseId: effective.courseId,
  unitMeasure: units.measure,
};

type ProductRow = typeof products.$inferSelect;
type UnitRow = typeof units.$inferSelect;

/** A row selecting {@link offerLineColumns}; the unit and category are LEFT-joined, so nullable. */
interface OfferLineRow {
  unitId: UnitRow["id"] | null;
  unitName: UnitRow["name"] | null;
  unitStaffName: UnitRow["staffName"] | null;
  unitStaffAbbreviation: UnitRow["staffAbbreviation"] | null;
  unitAbbreviation: UnitRow["abbreviation"] | null;
  unitPrecision: UnitRow["precision"] | null;
  hardwareUnit: UnitRow["hardwareUnit"] | null;
  vatClass: NonNullable<ProductRow["vatClass"]>;
  takeawayVatClass: VatClass;
  category: (typeof categories.$inferSelect)["name"] | null;
  allergens: ProductRow["allergens"];
  dietOverride: ProductRow["dietOverride"];
  dietaryDeclarations: NonNullable<ProductRow["dietaryDeclarations"]>;
  courseId: ProductRow["courseId"];
  unitMeasure: UnitRow["measure"] | null;
}

function offerLineValues(row: OfferLineRow) {
  return {
    unit: sellableUnit(
      row.unitId,
      row.unitName,
      row.unitPrecision,
      row.hardwareUnit,
      row.unitAbbreviation,
      row.unitStaffName,
      row.unitStaffAbbreviation,
      row.unitMeasure,
    ),
    pricingUnit: (row.hardwareUnit === null ? "each" : "weight") as PricingUnit,
    vatClass: row.vatClass as VatClass,
    takeawayVatClass: row.takeawayVatClass,
    category: row.category,
    ...productDeclarationValues(row),
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
          menuName: menus.name,
          name: products.name,
          customerName: products.customerName,
          kitchenName: products.kitchenName,
          ordering: products.ordering,
          available: products.available,
          ...offerLineColumns,
        })
        .from(menuItems)
        .innerJoin(menus, eq(menus.id, menuItems.menuId))
        .innerJoin(products, eq(products.id, menuItems.productId))
        .leftJoin(parentProducts, parentJoin)
        .leftJoin(units, unitOwnerJoin)
        .leftJoin(categories, eq(categories.id, effective.categoryId))
        .where(
          and(
            inArray(menuItems.menuId, menuIds),
            inArray(menuItems.productId, batch),
            eq(menus.active, true),
            isTopLevelProduct,
            eq(products.active, true),
          ),
        )),
    );
  const offered = rows.filter((row) => rankOf.get(row.menuId)!.has(row.productId));
  const menuOrder = new Map(
    roots.size > 1 && offered.length > 1
      ? (
          await tx
            .select({ id: menus.id })
            .from(menus)
            .where(inArray(menus.id, menuIds))
            .orderBy(menus.name, menus.id)
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
  const { rows: offered, placementsOf } = await offerRowsOn(tx, allRoots, graph);
  if (offered.length === 0) return [];
  const offeredByItem = await readOfferedModifiers(
    tx,
    offered.map((row) => ({ productId: row.productId, menuItemId: row.id })),
    { includeEveryModifierItem: options.includeEveryModifierItem === true },
  );
  const variantsByItem = await readOfferVariants(
    tx,
    offered.map((row) => row.id),
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
        product: {
          price: centsToDecimal(row.productPrice!),
          variants: offer.variants.map((v) => ({ variantId: v.id, price: v.productPrice })),
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
        variants: offer.variants.map(({ productPrice: variantProductPrice, ...variant }) => {
          const decision = combined.variants.find((v) => v.variantId === variant.id)!;
          return {
            ...variant,
            unitPrice:
              decision.price.state === "decided"
                ? decision.price.value
                : (variantProductPrice ?? centsToDecimal(row.productPrice!)),
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
 * Every product the menu reaches, once each in `listMenuOffers`' order, with its own price, its
 * combined decisions and its Active variants. Sold-out ones are listed.
 */
export async function menuPrices(tx: Transaction, menuId: string): Promise<MenuPriceRow[]> {
  await refuseSetMenu(tx, menuId);
  const rootSectionId = await requireMenuRoot(tx, menuId);
  const graph = await loadSectionGraph(tx);
  const roots = new Map([[menuId, rootSectionId]]);
  const combinedOffers = await offersOn(tx, roots, graph, {});
  const combinedByProduct = new Map(combinedOffers.map((offer) => [offer.productId, offer]));
  const { rows } = await offerRowsOn(tx, roots, graph);
  if (rows.length === 0) return [];
  const variantsByItem = await menuVariantsOfItems(
    tx,
    rows.map((row) => row.id),
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
        available: row.available,
        variants: variantsByItem.get(row.id) ?? [],
      };
    });
}

async function readOfferVariants(
  tx: Transaction,
  menuItemIds: readonly string[],
): Promise<Map<string, (MenuOfferVariant & { productPrice: Decimal | null })[]>> {
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
    .leftJoin(units, unitOwnerJoin)
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
  const grouped = new Map<string, (MenuOfferVariant & { productPrice: Decimal | null })[]>();
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
      productPrice: priceOrNull(row.ownPrice) as Decimal | null,
      menuPrice: priceOrNull(row.menuPrice),
      available: row.available,
      ...offerLineValues(row),
    });
    grouped.set(row.menuItemId, held);
  }
  return grouped;
}

export async function menuExists(tx: Transaction, menuId: string): Promise<boolean> {
  const [row] = await tx.select({ id: menus.id }).from(menus).where(eq(menus.id, menuId));
  return row !== undefined;
}

export async function updateMenuDetails(
  tx: Transaction,
  menuId: string,
  patch: {
    name?: string;
    names?: Record<string, string>;
    image?: string | null;
    color?: string | null;
    setPrice?: string | null;
    setVatClass?: VatClass | null;
  },
  fallbackLanguage?: string,
): Promise<void> {
  const changesTerms = patch.setPrice !== undefined || patch.setVatClass !== undefined;
  if (changesTerms) await requireSetMenu(tx, menuId);
  const rootSectionId = await requireMenuRoot(tx, menuId);
  const [stored] =
    patch.names === undefined
      ? []
      : await tx
          .select({ names: sections.names })
          .from(sections)
          .where(eq(sections.id, rootSectionId));
  const internalName = patch.name === undefined ? undefined : nameOf(patch.name, "internalName");
  const presentation = await sectionPatchValues(
    tx,
    {
      names: patch.names,
      image: patch.image,
      color: patch.color,
    },
    fallbackLanguage,
    stored?.names,
  );
  if (internalName !== undefined) await assertMenuNameFree(tx, internalName, menuId);
  if (internalName !== undefined || changesTerms) {
    await tx
      .update(menus)
      .set({
        name: internalName,
        setPrice: patch.setPrice === undefined ? undefined : setMenuPriceCents(patch.setPrice),
        setVatClass:
          patch.setVatClass === undefined ? undefined : setMenuVatClass(patch.setVatClass),
        updatedAt: now(),
      })
      .where(eq(menus.id, menuId));
  }
  if (Object.keys(presentation).length > 0) {
    await tx.update(sections).set(presentation).where(eq(sections.id, rootSectionId));
    if (internalName === undefined && !changesTerms) await touchSetMenu(tx, menuId);
  }
}

export async function deactivateMenu(
  tx: Transaction,
  id: string,
  personId: string | null = null,
): Promise<void> {
  const [row] = await tx
    .update(menus)
    .set({ active: false, updatedAt: now() })
    .where(and(eq(menus.id, id), eq(menus.active, true)))
    .returning({ name: menus.name });
  if (row !== undefined)
    await recordActivity(tx, {
      kind: "menu.archived",
      subjectId: id,
      personId,
      data: { name: row.name },
    });
}

export async function createProduct(tx: Transaction, input: CreateProductInput): Promise<Product> {
  return insertProduct(tx, input, true);
}

/** Skips the row's name check because the editor checks the whole family before writing. */
export async function createProductSkippingNameCheck(
  tx: Transaction,
  input: CreateProductInput,
): Promise<Product> {
  return insertProduct(tx, input, false);
}

type UnitAction = { kind: "keep" } | { kind: "clear" } | { kind: "set"; unit: SellableUnit };

async function resolveUnitAction(
  tx: Transaction,
  unitId: string | null | undefined,
  pricingUnit: PricingUnit | undefined,
): Promise<UnitAction> {
  if (unitId === null) return { kind: "clear" };
  if (unitId !== undefined) return { kind: "set", unit: await getSellableUnit(tx, unitId) };
  if (pricingUnit === undefined) return { kind: "keep" };
  if (pricingUnit === "each") return { kind: "clear" };
  if (pricingUnit === "weight") {
    const kg = await getSeededUnit(tx, "kg");
    if (kg === null) throw new AppError("product.invalid", { field: "unitId" });
    return { kind: "set", unit: kg };
  }
  // Any other legacy value is refused at the boundary, not silently treated as weight.
  throw new AppError("product.invalid", { field: "pricingUnit" });
}

async function insertProduct(
  tx: Transaction,
  input: CreateProductInput,
  checkNames: boolean,
): Promise<Product> {
  if (!input.name.trim()) throw new AppError("product.invalid", { field: "name" });
  if (stringToCents(input.unitPrice) < 0)
    throw new AppError("product.invalid", { field: "unitPrice" });
  const unitAction = await resolveUnitAction(tx, input.unitId, input.pricingUnit);
  if (unitAction.kind === "keep") throw new AppError("product.invalid", { field: "unitId" });
  const selectedUnit = unitAction.kind === "set" ? unitAction.unit : null;
  const takeawayVatClass = input.takeawayVatClass ?? null;
  if (takeawayVatClass !== null && !VAT_CLASSES.includes(takeawayVatClass))
    throw new AppError("product.invalid", { field: "takeawayVatClass" });
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  const dietOverride = validateDietOverride(input.dietOverride ?? null);
  const values = {
    categoryId: input.categoryId,
    name: input.name,
    customerName: input.customerName ?? null,
    description: input.description ?? null,
    kitchenName: input.kitchenName?.trim() || null,
    dietaryDeclarations: validateDietaryDeclarations(input.dietaryDeclarations ?? []),
    unitPrice: stringToCents(input.unitPrice),
    vatClass: input.vatClass,
    takeawayVatClass,
    active: input.active ?? true,
    available: input.available ?? true,
    ordering: input.ordering ?? "public",
    allergens: publishedAllergens(allergens),
    dietOverride,
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
    .leftJoin(units, unitOwnerJoin)
    .where(eq(products.id, row!.id));
  return toProduct(created!);
}

export async function listProducts(tx: Transaction): Promise<Product[]> {
  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(units, unitOwnerJoin)
    .where(isTopLevelProduct)
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
      ownAllergens: products.allergens,
      allergens: effective.allergens,
      available: products.available,
      active: products.active,
      unitPrice: effective.unitPrice,
      vatClass: effective.vatClass,
      takeawayVatClass: effective.takeawayVatClass,
      primaryCategoryId: effective.categoryId,
      courseId: products.courseId,
      effectiveCourseId: effective.courseId,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.parentId, [...productIds]))
    .orderBy(products.parentId, products.variantOrder, products.id);
  const grouped = new Map<string, ListedVariant[]>();
  for (const {
    parentId,
    ownPrice,
    ownAllergens,
    allergens,
    unitPrice,
    vatClass,
    takeawayVatClass,
    primaryCategoryId,
    effectiveCourseId,
    ...row
  } of rows) {
    const held = grouped.get(parentId!) ?? [];
    held.push({
      ...row,
      unitPrice: priceOrNull(ownPrice),
      allergensInherited: ownAllergens === null,
      effective: {
        allergens,
        unitPrice: centsToDecimal(unitPrice),
        vatClass: vatClass as VatClass,
        takeawayVatClass,
        primaryCategoryId,
        courseId: effectiveCourseId,
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
  personId: string | null = null,
): Promise<void> {
  await patchProduct(tx, id, patch, true, personId);
}

/** {@link updateProduct} without the unique-name check, for the reason
 * {@link createProductSkippingNameCheck} gives. Left out of the package's exports (`index.ts`). */
export async function updateProductSkippingNameCheck(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
  personId: string | null = null,
): Promise<void> {
  await patchProduct(tx, id, patch, false, personId);
}

async function patchProduct(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
  checkNames: boolean,
  personId: string | null,
): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim())
    throw new AppError("product.invalid", { field: "name" });
  if (patch.unitPrice != null && stringToCents(patch.unitPrice) < 0)
    throw new AppError("product.invalid", { field: "unitPrice" });
  const namesChange = checkNames && (patch.name !== undefined || patch.active !== undefined);
  const row = await readUpdatedName(tx, id);
  if (row !== undefined && (!row.active || row.parentActive === false))
    throw new AppError("product.archived", { productId: id });
  // Archive before writing the patch: archiving skips rows already inactive.
  if (patch.active === false && row?.active === true) await archiveProducts(tx, [id], personId);
  if (patch.active === true && row?.parentId != null)
    await assertNotOfferedAsExtra(tx, row.parentId, "active");
  if (namesChange && row !== undefined)
    await assertUpdatedNamesFree(tx, row, { name: patch.name, active: patch.active });
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
    if (color !== undefined)
      colorOrNull(color, () => {
        throw new AppError("product.invalid", { field: "color" });
      });
  };
  // The refusal order is pinned by the "a product's own colour" cases in operations.test.ts.
  if (categoryId === undefined) assertColor();
  if (categoryId !== undefined || color !== undefined) {
    if (row === undefined || row.parentId !== null)
      throw new AppError("product.not_found", { productId: id });
  }
  if (categoryId != null) await readCategory(tx, categoryId);
  if (categoryId !== undefined) assertColor();
  if (allergens != null) validateAllergens(allergens);
  if (dietOverride !== undefined) validateDietOverride(dietOverride);
  const directDietary =
    dietaryDeclarations === undefined || dietaryDeclarations === null
      ? dietaryDeclarations
      : validateDietaryDeclarations(dietaryDeclarations);
  const unitAction = await resolveUnitAction(tx, unitId, pricingUnit);
  await tx
    .update(products)
    .set({
      ...rest,
      ...(unitPrice === undefined
        ? {}
        : { unitPrice: unitPrice === null ? null : stringToCents(unitPrice) }),
      ...(allergens !== undefined ? { allergens: publishedAllergens(allergens) } : {}),
      ...(dietOverride !== undefined ? { dietOverride } : {}),
      ...(directDietary === undefined ? {} : { dietaryDeclarations: directDietary }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(color === undefined ? {} : { color }),
      updatedAt: now(),
    })
    .where(eq(products.id, id));
  if (unitAction.kind === "set") await assignProductUnit(tx, id, unitAction.unit.id);
  else if (unitAction.kind === "clear") await clearProductUnit(tx, id);
}

export async function deactivateProduct(
  tx: Transaction,
  id: string,
  personId: string | null = null,
): Promise<void> {
  await archiveProducts(tx, [id], personId);
}

export async function readDefaultMenuId(tx: Transaction): Promise<string | null> {
  const [row] = await tx.select({ id: menus.id }).from(menus).where(eq(menus.isDefault, true));
  return row?.id ?? null;
}

export async function assignMenuToVenue(tx: Transaction, menuId: string): Promise<void> {
  await tx.update(menus).set({ isDefault: false }).where(eq(menus.isDefault, true));
  await tx.update(menus).set({ isDefault: true }).where(eq(menus.id, menuId));
}

export async function setVenueDefaultMenu(tx: Transaction, menuId: string): Promise<void> {
  await assertMenuExists(tx, menuId);
  await refuseSetMenu(tx, menuId);
  await assignMenuToVenue(tx, menuId);
}

async function assertMenuExists(tx: Transaction, menuId: string): Promise<void> {
  if (!(await menuExists(tx, menuId))) throw new AppError("menu.not_found", { menuId });
}

export async function readInvoiceLocales(tx: Transaction): Promise<string[]> {
  return readVenueInvoiceLocales(tx);
}

/**
 * The venue's receipt language — the FIRST of its saved `invoice_locales` — together with the
 * whole list.
 */
export async function readReceiptLanguage(
  tx: Transaction,
): Promise<{ locale: string; invoiceLocales: string[] }> {
  const invoiceLocales = await readInvoiceLocales(tx);
  const locale = invoiceLocales[0];
  if (locale === undefined) throw new Error("readReceiptLanguage: the venue has no language");
  return { locale, invoiceLocales };
}

export async function listAvailableProducts(
  tx: Transaction,
): Promise<{ products: AvailableProduct[]; invoiceLocales: string[] }> {
  const invoiceLocales = await readVenueInvoiceLocales(tx);
  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      customerName: products.customerName,
      unitId: units.id,
      unitName: units.name,
      unitStaffName: units.staffName,
      unitStaffAbbreviation: units.staffAbbreviation,
      unitAbbreviation: units.abbreviation,
      unitPrecision: units.precision,
      hardwareUnit: units.hardwareUnit,
      unitPrice: effective.unitPrice,
      vatClass: effective.vatClass,
      takeawayVatClass: effective.takeawayVatClass,
      category: categories.name,
      allergens: effective.allergens,
      dietOverride: effective.dietOverride,
      dietaryDeclarations: effective.dietaryDeclarations,
      courseId: effective.courseId,
      unitMeasure: units.measure,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(units, unitOwnerJoin)
    .leftJoin(categories, eq(categories.id, effective.categoryId))
    .where(
      and(
        eq(products.active, true),
        eq(products.available, true),
        // A variant is sold only through its parent's menu offer, never as a product in its own
        // right: sold from here it would be filed under its own names as if it had no parent.
        isTopLevelProduct,
      ),
    )
    .orderBy(products.createdAt, products.id);

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
      row.unitStaffName,
      row.unitStaffAbbreviation,
      row.unitMeasure,
    ),
    pricingUnit: (row.hardwareUnit === null ? "each" : "weight") as PricingUnit,
    unitPrice: centsToDecimal(row.unitPrice),
    vatClass: row.vatClass as VatClass,
    takeawayVatClass: row.takeawayVatClass,
    category: row.category,
    ...productDeclarationValues(row),
    courseId: row.courseId,
    offeredModifiers: offeredByProduct.get(row.id) ?? [],
  }));
  return { products: available, invoiceLocales };
}
