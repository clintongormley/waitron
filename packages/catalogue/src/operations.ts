import { and, eq, inArray, sql } from "drizzle-orm";
import { catalogues, categories, locationCatalogues, locations, products } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { validateAllergens, type ProductAllergens } from "./allergens.js";
import { republish, type RecipeDerivation } from "./derivation.js";
import type { PricingUnit, VatClass } from "./pricing.js";

/**
 * Catalogue operations — CRUD over `catalogues`/`categories`/`products`, catalogue↔location
 * assignment, and the read the till sells from (`listAvailableProducts`).
 *
 * Every function takes a `(tx, …)` and runs under the CALLER's tenant context: the caller opens the
 * transaction with `withTenant` (and `asAppUser` in the running POS), so writes adopt that tenant
 * through `current_tenant_id()` and reads are filtered to it by the tenant-isolation policy (0027).
 * Nothing here takes a `tenantId` argument — the GUC the caller already set is the single source of
 * it, which is also what satisfies every table's `WITH CHECK (tenant_id = current_tenant_id())`.
 *
 * Deactivation is `active = false`, never DELETE: a product may sit behind historical sale-line
 * snapshots, and the app role holds no DELETE grant anyway (0027; proven in operations.rls.test.ts).
 * All SQL is built with Drizzle query builders — no string concatenation.
 */

export interface Catalogue {
  id: string;
  name: string;
  active: boolean;
  /** The sync seam, bumped by a future replication task; created at 1. */
  version: number;
}

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per item for `each`, per kg for `weight`. */
  unitPrice: string;
  vatClass: VatClass;
  active: boolean;
  /** EU 1169/2011 Annex II declaration, or null when not yet reviewed (a compliance gap). This is the
   * PUBLISHED union: the manual overlay merged with any recipe-derived floor (`republish`). */
  allergens: ProductAllergens | null;
  /** The staff-authored overlay ALONE, before the recipe floor is unioned in — null when unreviewed.
   * Exposed distinctly from `allergens` so an editor seeds its picker from the manual value without
   * double-counting recipe-derived allergens. */
  manualAllergens: ProductAllergens | null;
  /** Content-addressed photo filename served at `/media/<image>`, or null when there is no picture. */
  image: string | null;
}

export interface CreateProductInput {
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  /** Omitted leaves it null (unreviewed); validated against the EU-14 taxonomy on insert. */
  allergens?: ProductAllergens;
  /** A stored photo reference (`<sha256>.<ext>`); omitted leaves it null (no picture). */
  image?: string;
  /** Omitted leaves it active, mirroring the `products.active` column default. Set `false` to create
   * a product that is not yet sellable at the till — atomic in the one insert, no follow-up patch. */
  active?: boolean;
}

/** The mutable slice of a product. Absent keys are left unchanged (the object literal a caller
 * passes carries only the columns it means to touch); `updatedAt` is always bumped. */
export interface UpdateProductInput {
  descriptions?: Record<string, string>;
  unitPrice?: string;
  vatClass?: VatClass;
  pricingUnit?: PricingUnit;
  categoryId?: string | null;
  /** `null` clears the declaration back to unreviewed; omitted leaves it unchanged. */
  allergens?: ProductAllergens | null;
  /** `null` clears the photo reference; omitted leaves it unchanged. */
  image?: string | null;
  /** Toggle active/inactive through the edit route; omitted leaves it unchanged. */
  active?: boolean;
}

/**
 * A product the till can sell at a location, shaped so it is structurally assignable to
 * {@link PriceableProduct} — Task 6 feeds `listAvailableProducts(...)` rows straight into
 * `priceBasket`. `category` is the resolved category NAME (left-joined), or null.
 */
export interface AvailableProduct {
  id: string;
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  category: string | null;
  allergens: ProductAllergens | null;
  /** The product's DEFAULT kitchen course (KDS-2 `products.course_id`), or null when it has none. The
   * ring-time resolver reads it as the fallback (`<override> ?? course_id`), and the till's tab course
   * picker reads it as the per-line PRE-SELECTED default. An extra field beyond `PriceableProduct`, so
   * a `listAvailableProducts` row stays structurally assignable to it (priceBasket ignores it). */
  courseId: string | null;
  /** The catalogue (menu) this product is sold from — its `catalogues.id`. A location may sell across
   * several accessible catalogues (its default plus any `location_catalogues` members), so a row is
   * tagged with which one it came from. An extra field beyond `PriceableProduct`, so the row stays
   * structurally assignable to it (priceBasket ignores it, like `courseId`). */
  catalogueId: string;
  /** The catalogue's display name (`catalogues.name`), for grouping products by menu in the till. Also
   * beyond `PriceableProduct` and ignored by priceBasket. */
  catalogueName: string;
}

const CATALOGUE_COLUMNS = {
  id: catalogues.id,
  name: catalogues.name,
  active: catalogues.active,
  version: catalogues.version,
};

const CATEGORY_COLUMNS = {
  id: categories.id,
  name: categories.name,
};

const PRODUCT_COLUMNS = {
  id: products.id,
  catalogueId: products.catalogueId,
  categoryId: products.categoryId,
  descriptions: products.descriptions,
  pricingUnit: products.pricingUnit,
  unitPrice: products.unitPrice,
  vatClass: products.vatClass,
  active: products.active,
  allergens: products.allergens,
  manualAllergens: products.manualAllergens,
  image: products.image,
};

/** The product row as Drizzle types it back: `pricing_unit`/`vat_class` are `text` columns, so they
 * arrive as bare `string` before {@link toProduct} re-attaches their union types. */
interface RawProduct {
  id: string;
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  pricingUnit: string;
  unitPrice: string;
  vatClass: string;
  active: boolean;
  allergens: ProductAllergens | null;
  manualAllergens: ProductAllergens | null;
  image: string | null;
}

// `pricing_unit`/`vat_class` are constrained to their unions by a CHECK (catalogue.ts), so the value
// read back is always a `PricingUnit`/`VatClass`; the cast re-attaches the type the column's runtime
// CHECK already guarantees.
function toProduct(row: RawProduct): Product {
  return {
    ...row,
    pricingUnit: row.pricingUnit as PricingUnit,
    vatClass: row.vatClass as VatClass,
  };
}

/** The tenant scope, as an insertable value. `current_tenant_id()` reads the `app.tenant_id` GUC the
 * caller set via `withTenant`, so the inserted row satisfies each table's WITH CHECK. */
const CURRENT_TENANT = sql`current_tenant_id()`;

export async function createCatalogue(
  tx: Transaction,
  input: { name: string },
): Promise<Catalogue> {
  const [row] = await tx
    .insert(catalogues)
    .values({ tenantId: CURRENT_TENANT, name: input.name })
    .returning(CATALOGUE_COLUMNS);
  return row!;
}

export async function listCatalogues(tx: Transaction): Promise<Catalogue[]> {
  return tx.select(CATALOGUE_COLUMNS).from(catalogues).orderBy(catalogues.createdAt, catalogues.id);
}

export async function renameCatalogue(tx: Transaction, id: string, name: string): Promise<void> {
  await tx
    .update(catalogues)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(catalogues.id, id));
}

export async function deactivateCatalogue(tx: Transaction, id: string): Promise<void> {
  await tx
    .update(catalogues)
    .set({ active: false, updatedAt: sql`now()` })
    .where(eq(catalogues.id, id));
}

export async function createCategory(tx: Transaction, input: { name: string }): Promise<Category> {
  const [row] = await tx
    .insert(categories)
    .values({ tenantId: CURRENT_TENANT, name: input.name })
    .returning(CATEGORY_COLUMNS);
  return row!;
}

export async function listCategories(tx: Transaction): Promise<Category[]> {
  return tx.select(CATEGORY_COLUMNS).from(categories).orderBy(categories.createdAt, categories.id);
}

export async function renameCategory(tx: Transaction, id: string, name: string): Promise<void> {
  await tx
    .update(categories)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(categories.id, id));
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

export async function createProduct(tx: Transaction, input: CreateProductInput): Promise<Product> {
  // Validate before the write: an unreviewed product stores null, a supplied map is checked against
  // the EU-14 taxonomy and rejected (throws `allergen.invalid_code`/`allergen.invalid_presence`)
  // before any row is inserted. The map is the MANUAL overlay; at create there is no recipe, so the
  // published `allergens` is `republish(manual, null)` — which is exactly `manual` (or null when
  // unreviewed), preserving today's round-trip behaviour.
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  const [row] = await tx
    .insert(products)
    .values({
      tenantId: CURRENT_TENANT,
      catalogueId: input.catalogueId,
      categoryId: input.categoryId,
      descriptions: input.descriptions,
      pricingUnit: input.pricingUnit,
      unitPrice: input.unitPrice,
      vatClass: input.vatClass,
      active: input.active ?? true,
      manualAllergens: allergens,
      allergens: republish(allergens, null),
      image: input.image ?? null,
    })
    .returning(PRODUCT_COLUMNS);
  return toProduct(row!);
}

export async function listProducts(tx: Transaction, catalogueId: string): Promise<Product[]> {
  const rows = await tx
    .select(PRODUCT_COLUMNS)
    .from(products)
    .where(eq(products.catalogueId, catalogueId))
    .orderBy(products.createdAt, products.id);
  return rows.map(toProduct);
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
  const { allergens, ...rest } = patch;
  if (allergens != null) validateAllergens(allergens);
  await tx
    .update(products)
    .set({
      ...rest,
      ...(allergens !== undefined ? { manualAllergens: allergens } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(products.id, id));
  if (allergens !== undefined) await republishProduct(tx, id);
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
 * Attach a NON-default catalogue to a location's accessible set (a `location_catalogues` row): the
 * location may then sell from it alongside its default `catalogue_id`. Idempotent — the composite PK
 * (tenant_id, location_id, catalogue_id) makes a re-attach a no-op via `onConflictDoNothing`. The
 * default assignment stays with {@link assignCatalogueToLocation}; this only adds OTHER menus.
 */
export async function addCatalogueToLocation(
  tx: Transaction,
  locationId: string,
  catalogueId: string,
): Promise<void> {
  await tx
    .insert(locationCatalogues)
    .values({ tenantId: CURRENT_TENANT, locationId, catalogueId })
    .onConflictDoNothing();
}

/**
 * The catalogue ids a location may sell from: its default (`locations.catalogue_id`, when non-null)
 * unioned with every `location_catalogues` member, de-duplicated (a `Set`, since the default may also
 * appear as a member). Order is not meaningful — {@link listAvailableProducts} sorts by catalogue
 * name — so the returned array is just the set's insertion order.
 */
export async function resolveAccessibleCatalogueIds(
  tx: Transaction,
  locationId: string,
): Promise<string[]> {
  const [def] = await tx
    .select({ id: locations.catalogueId })
    .from(locations)
    .where(eq(locations.id, locationId));
  const members = await tx
    .select({ id: locationCatalogues.catalogueId })
    .from(locationCatalogues)
    .where(eq(locationCatalogues.locationId, locationId));
  const ids = new Set<string>();
  if (def?.id != null) ids.add(def.id);
  for (const m of members) ids.add(m.id);
  return [...ids];
}

export interface AccessibleCatalogue {
  id: string;
  name: string;
  /** True for `locations.catalogue_id` — the till's menu switcher pre-selects this one. */
  isDefault: boolean;
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
  const [loc] = await tx
    .select({ defaultId: locations.catalogueId })
    .from(locations)
    .where(eq(locations.id, locationId));
  const ids = await resolveAccessibleCatalogueIds(tx, locationId);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: catalogues.id, name: catalogues.name })
    .from(catalogues)
    .where(and(inArray(catalogues.id, ids), eq(catalogues.active, true)));
  return rows
    .map((r) => ({ id: r.id, name: r.name, isDefault: r.id === loc?.defaultId }))
    .sort((a, b) =>
      a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
    );
}

/**
 * The products the till can sell at `locationId`, across the WHOLE accessible catalogue set (the
 * default plus any `location_catalogues` members — see {@link resolveAccessibleCatalogueIds}), each
 * row tagged with the `catalogueId`/`catalogueName` it came from. Keeps only active products of an
 * active catalogue, with the category NAME resolved via a left join (null when the product has no
 * category). Returns `[]` when the location has no accessible catalogue at all. Ordered by catalogue
 * name, then product `created_at`, then `id` so the result is stable and grouped by menu.
 */
export async function listAvailableProducts(
  tx: Transaction,
  locationId: string,
): Promise<AvailableProduct[]> {
  const accessible = await resolveAccessibleCatalogueIds(tx, locationId);
  if (accessible.length === 0) return [];
  const rows = await tx
    .select({
      id: products.id,
      descriptions: products.descriptions,
      pricingUnit: products.pricingUnit,
      unitPrice: products.unitPrice,
      vatClass: products.vatClass,
      category: categories.name,
      allergens: products.allergens,
      courseId: products.courseId,
      catalogueId: catalogues.id,
      catalogueName: catalogues.name,
    })
    .from(products)
    .innerJoin(catalogues, eq(catalogues.id, products.catalogueId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        inArray(catalogues.id, accessible),
        eq(catalogues.active, true),
        eq(products.active, true),
      ),
    )
    .orderBy(catalogues.name, products.createdAt, products.id);
  return rows.map((row) => ({
    id: row.id,
    descriptions: row.descriptions,
    pricingUnit: row.pricingUnit as PricingUnit,
    unitPrice: row.unitPrice,
    vatClass: row.vatClass as VatClass,
    category: row.category,
    allergens: row.allergens,
    courseId: row.courseId,
    catalogueId: row.catalogueId,
    catalogueName: row.catalogueName,
  }));
}
