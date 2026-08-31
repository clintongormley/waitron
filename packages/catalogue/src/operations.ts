import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
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
import type { Transaction } from "@waitron/db";
import "./errors.js"; // load the code registry for `options.group_invalid`/`options.item_invalid` thrown below
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
 * One selectable choice within a {@link ResolvedOptionGroup} (an active `option_group_items` row).
 * `priceDelta` is the GROSS (VAT-inclusive) numeric column carried as a string, like `unitPrice`.
 * `vatClass` is `null` when the item INHERITS the parent dish's rate (`option_group_items.vat_class`
 * NULL); a non-null value overrides it. Later tasks price a selection against these.
 */
export interface ResolvedOptionItem {
  id: string;
  name: Record<string, string>;
  priceDelta: string;
  vatClass: VatClass | null;
  /** The AUTHORED per-option cap (`option_group_items.max_quantity`, NOT NULL default 1): the most of
   * THIS option a diner may take on one dish (per-option quantity). The sale path validates a selected
   * option's quantity is an integer in `1..maxQuantity` and prices the child at `dishQty × optionQty`. */
  maxQuantity: number;
}

/**
 * An active `option_groups` row attached to a product, with its active items resolved and sorted.
 * `minSelect`/`maxSelect` bound how many items a diner may pick and `required` forces at least one;
 * later tasks validate a selection against these. `items` is in `option_group_items.sort` order and
 * excludes inactive items; an active group with no active items resolves to `items: []`.
 */
export interface ResolvedOptionGroup {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  items: ResolvedOptionItem[];
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
  /** The product's attached ACTIVE option groups (Task 1 tables), each with its active items in sort
   * order — `[]` when the product has none. Beyond `PriceableProduct` and ignored by priceBasket;
   * later tasks price + validate a diner's selection against these. */
  optionGroups: ResolvedOptionGroup[];
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

/**
 * Whether `catalogueId` names a catalogue VISIBLE to the current tenant — the trust-boundary check the
 * location-menu write routes run on an untrusted `catalogueId` before {@link addCatalogueToLocation} /
 * {@link setLocationDefaultCatalogue}. The read is RLS-filtered, so another tenant's catalogue reads as
 * absent (`false`). This is the FRONT of a two-layer defense: both `locations.catalogue_id` and
 * `location_catalogues.catalogue_id` now carry tenant-consistent COMPOSITE FKs (migrations 0078 / 0074),
 * so a cross-tenant id is rejected at the DATA layer too (23503) — this check's job is the CLEAN error,
 * turning that opaque 500 into `catalogue.not_found` (404) uniformly across both routes.
 */
export async function catalogueExists(tx: Transaction, catalogueId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(eq(catalogues.id, catalogueId));
  return row !== undefined;
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
 * Detach a catalogue from a location's accessible set (delete its `location_catalogues` row): the
 * location stops selling from it. Idempotent — deleting a row that is not there is a no-op. This
 * NEVER touches the default (`locations.catalogue_id`), which is not stored as a member row, so it
 * cannot strip a location's default menu; call {@link assignCatalogueToLocation} to change the
 * default. `app_user` holds DELETE on `location_catalogues` (0074).
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

export interface AccessibleCatalogue {
  id: string;
  name: string;
  /** True for `locations.catalogue_id` — the till's menu switcher pre-selects this one. */
  isDefault: boolean;
}

export interface LocationCatalogue extends Catalogue {
  /** In this location's accessible set — its default (`locations.catalogue_id`) OR a
   * `location_catalogues` member. The set the till sells from. */
  sellable: boolean;
  /** This location's default menu (`locations.catalogue_id`); always also `sellable`. */
  isDefault: boolean;
}

/**
 * EVERY catalogue the tenant owns, each flagged with whether `locationId` may sell from it
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
        });
      }
    }
  }

  // `products` is the imported table, so the mapped rows take a local name of their own.
  const available = rows.map((row) => ({
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
    optionGroups: groupsByProduct.get(row.id) ?? [],
  }));
  return { products: available, invoiceLocales };
}

// ── Option group + item authoring (ordering modifiers, Task 11) ──────────────────────────────────
// The dashboard's modifier-authoring surface: CRUD the reusable `option_groups` and their
// `option_group_items`, and attach an ordered set of groups to a product (`product_option_groups`).
// The sale-time READ lives above (`listAvailableProducts`); these are the WRITES that build what it
// reads. Every function runs under the caller's tenant context (withTenant + asAppUser), so
// `current_tenant_id()` scopes each write and RLS filters each read — the same posture as the
// catalogue/category/product ops above.

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
}

export interface UpdateOptionGroupItemInput {
  name?: Record<string, string>;
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
  /** Absent leaves the stored value unchanged; a present value is re-validated as an integer >= 1. */
  maxQuantity?: number;
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
};

/**
 * Enforce the `option_groups` invariants BEFORE the write, so an invalid config is a clean
 * `options.group_invalid` (400) rather than the opaque 500 the DB CHECK constraints
 * (`option_groups_select_ck` / `option_groups_required_ck`) would raise as a backstop. These are the
 * SAME two rules the CHECKs encode: `max_select >= min_select >= 0`, and `required ⇒ min_select >= 1`.
 * `reason` is the stable code the sale-time `options.selection_invalid` also uses.
 */
function validateOptionGroupBounds(minSelect: number, maxSelect: number, required: boolean): void {
  if (minSelect < 0 || maxSelect < minSelect) {
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

export async function createOptionGroup(
  tx: Transaction,
  input: CreateOptionGroupInput,
): Promise<OptionGroup> {
  // Resolve the column defaults HERE so the invariant is validated against the values that will land
  // (the DB defaults are min 0, max 1, required false).
  const minSelect = input.minSelect ?? 0;
  const maxSelect = input.maxSelect ?? 1;
  const required = input.required ?? false;
  validateOptionGroupBounds(minSelect, maxSelect, required);
  const [row] = await tx
    .insert(optionGroups)
    .values({
      tenantId: CURRENT_TENANT,
      name: input.name,
      minSelect,
      maxSelect,
      required,
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.active === undefined ? {} : { active: input.active }),
    })
    .returning(OPTION_GROUP_COLUMNS);
  return row!;
}

/** Every option group of the tenant (active AND inactive), for the authoring editor. Ordered by `sort`
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
  await tx.update(optionGroups).set(patch).where(eq(optionGroups.id, id));
}

export async function createOptionGroupItem(
  tx: Transaction,
  groupId: string,
  input: CreateOptionGroupItemInput,
): Promise<OptionGroupItem> {
  // Resolve the default HERE so the invariant is validated against the value that will land (the DB
  // default is 1), the same posture createOptionGroup takes for its bounds.
  const maxQuantity = input.maxQuantity ?? 1;
  validateOptionGroupItemMaxQuantity(maxQuantity);
  const [row] = await tx
    .insert(optionGroupItems)
    .values({
      tenantId: CURRENT_TENANT,
      groupId,
      name: input.name,
      maxQuantity,
      ...(input.priceDelta === undefined ? {} : { priceDelta: input.priceDelta }),
      ...(input.vatClass === undefined ? {} : { vatClass: input.vatClass }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.active === undefined ? {} : { active: input.active }),
    })
    .returning(OPTION_GROUP_ITEM_COLUMNS);
  return { ...row!, vatClass: row!.vatClass as VatClass | null };
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
  return rows.map((r) => ({ ...r, vatClass: r.vatClass as VatClass | null }));
}

export async function updateOptionGroupItem(
  tx: Transaction,
  itemId: string,
  patch: UpdateOptionGroupItemInput,
): Promise<void> {
  // maxQuantity's invariant is single-field, so there is nothing to merge onto: a patch that omits it
  // leaves the stored value untouched (Drizzle `.set()` only writes provided keys); a patch that sets
  // it is re-validated here before the write, the same clean-error-before-the-CHECK posture create takes.
  if (patch.maxQuantity !== undefined) validateOptionGroupItemMaxQuantity(patch.maxQuantity);
  await tx.update(optionGroupItems).set(patch).where(eq(optionGroupItems.id, itemId));
}

/**
 * Replace a product's attached option groups with `groupIds`, IN ORDER — a full replace, not a merge.
 * Every existing `product_option_groups` row for the product is deleted, then one row per id is
 * inserted with `sort` = its index, so the list's order becomes the per-attachment display order the
 * till read (`listAvailableProducts`) sorts by. An empty list detaches everything. Runs in the caller's
 * tenant transaction, so `current_tenant_id()` scopes both the delete and the inserts, and the
 * tenant-consistent (tenant_id, group_id) FK refuses a group that is not this tenant's.
 */
export async function setProductOptionGroups(
  tx: Transaction,
  productId: string,
  groupIds: string[],
): Promise<void> {
  await tx.delete(productOptionGroups).where(eq(productOptionGroups.productId, productId));
  if (groupIds.length === 0) return;
  await tx.insert(productOptionGroups).values(
    groupIds.map((groupId, index) => ({
      tenantId: CURRENT_TENANT,
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
