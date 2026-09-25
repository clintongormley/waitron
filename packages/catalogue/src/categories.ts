import { categories, now, products, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE, isUuid } from "@waitron/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { categoryDetails } from "./schema/categories.js";
import { productLabels } from "./schema/labels.js";
import { validateContentTranslations } from "./content-languages.js";
import { labelIdArray } from "./labels.js";
import {
  isTopLevelProduct,
  labelOwnerJoin,
  productWithId,
  type ProductScope,
} from "./variant-fallback.js";
import "./errors.js";

export interface Category {
  id: string;
  name: Record<string, string>;
  image: string | null;
  color: string | null;
  parentId: string | null;
}
export interface CategoryInput {
  name: Record<string, string>;
  image?: string | null;
  color?: string | null;
  parentId?: string | null;
}
/** Where a deleted category's products and direct children go. An absent key takes the default: the
 * deleted category's parent, which for a top-level category is none (Uncategorised, or the top level). */
export interface CategoryReassignment {
  productsTo?: string | null;
  childrenTo?: string | null;
}

const columns = {
  id: categories.id,
  name: categories.name,
  image: categoryDetails.image,
  color: categoryDetails.color,
  parentId: categoryDetails.parentId,
};

/*
 * Hierarchy edits, main-category changes and deletion take no lock: `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside the venue file's write queue, which admits
 * one write transaction at a time (`packages/store/src/write-queue.ts`), so two of these paths
 * cannot overlap however they are started. Receipt: `racePair` in
 * `packages/catalogue/test/fixtures.ts`.
 */
export async function listCategories(tx: Transaction): Promise<Category[]> {
  return tx
    .select(columns)
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
    .orderBy(categories.createdAt, categories.id);
}
export async function readCategory(tx: Transaction, id: string): Promise<Category> {
  const [row] = await tx
    .select(columns)
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
    .where(eq(categories.id, id));
  if (!row) throw new AppError("category.not_found", { categoryId: id });
  return row;
}
async function validateParent(tx: Transaction, id: string, parentId: string | null): Promise<void> {
  const seen = new Set([id]);
  while (parentId !== null) {
    if (seen.has(parentId)) throw new AppError("category.parent_cycle", {});
    seen.add(parentId);
    parentId = (await readCategory(tx, parentId)).parentId;
  }
}
/** Does the media library hold this file? Never, where the media module is not installed. */
export async function mediaImageExists(tx: Transaction, filename: string): Promise<boolean> {
  if (!(await tablePresent(tx, "media_images"))) return false;
  // The media module owns the reference. The row cannot be deleted between this read and the
  // write that depends on it: one write transaction runs on the venue file at a time, so there is
  // no concurrent deleter to hold the reference against.
  const image = await tx.execute(sql`select 1 from media_images where filename = ${filename}`);
  return image.rows.length > 0;
}
async function validateImage(tx: Transaction, filename: string | null): Promise<void> {
  if (filename !== null && !(await mediaImageExists(tx, filename)))
    throw new AppError("category.image_not_found", {});
}
/**
 * Has an optional module's table been migrated into this database?
 *
 * `media_images` and `preparation_routes` both belong to modules a venue need not have, so every
 * path that names one in raw SQL asks first. The count is read rather than a boolean expression:
 * this is a raw statement, so no drizzle column mapping runs over the result and SQLite has no
 * boolean type — a `... is not null` expression comes back as the number 1 or 0.
 */
async function tablePresent(tx: Transaction, name: string): Promise<boolean> {
  const found = await tx.execute<{ n: number }>(
    sql`select count(*) as n from sqlite_master where type = 'table' and name = ${name}`,
  );
  return found.rows[0]!.n > 0;
}
function validateColor(color: string | null | undefined): void {
  if (color === undefined || color === null) return;
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new AppError("category.color_invalid", {});
}
export async function createCategory(
  tx: Transaction,
  input: CategoryInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<Category> {
  await validateContentTranslations(tx, input.name, fallbackLanguage);
  validateColor(input.color);
  const id = crypto.randomUUID();
  await validateParent(tx, id, input.parentId ?? null);
  await validateImage(tx, input.image ?? null);
  await tx.insert(categories).values({ id, name: input.name });
  await tx.insert(categoryDetails).values({
    categoryId: id,
    parentId: input.parentId ?? null,
    image: input.image ?? null,
    color: input.color ?? null,
  });
  return readCategory(tx, id);
}
export async function updateCategory(
  tx: Transaction,
  id: string,
  patch: Partial<CategoryInput>,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<Category> {
  if (patch.name !== undefined) await validateContentTranslations(tx, patch.name, fallbackLanguage);
  const current = await readCategory(tx, id);
  const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  const image = patch.image === undefined ? current.image : patch.image;
  const color = patch.color === undefined ? current.color : patch.color;
  await validateParent(tx, id, parentId);
  await validateImage(tx, image);
  validateColor(color);
  await tx
    .update(categories)
    .set({ name: patch.name ?? current.name, updatedAt: now() })
    .where(eq(categories.id, id));
  await tx
    .insert(categoryDetails)
    .values({ categoryId: id, parentId, image, color })
    .onConflictDoUpdate({
      target: categoryDetails.categoryId,
      set: { parentId, image, color },
    });
  return readCategory(tx, id);
}
/** Every category below `id` in the tree, at any depth; not `id` itself. */
async function descendantsOf(tx: Transaction, id: string): Promise<Set<string>> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    with recursive below(id) as (
      select category_id from category_details where parent_id = ${id}
      union
      select d.category_id from category_details d join below on d.parent_id = below.id
    )
    select id from below`);
  return new Set(rows.map((row) => row.id));
}
export async function deleteCategory(
  tx: Transaction,
  id: string,
  reassign: CategoryReassignment = {},
): Promise<void> {
  const category = await readCategory(tx, id); // 404s an absent id
  const productsTo = reassign.productsTo === undefined ? category.parentId : reassign.productsTo;
  const childrenTo = reassign.childrenTo === undefined ? category.parentId : reassign.childrenTo;
  if (productsTo === id) throw new AppError("category.reassign_invalid", { field: "productsTo" });
  if (childrenTo === id) throw new AppError("category.reassign_invalid", { field: "childrenTo" });
  if (productsTo !== null) await readCategory(tx, productsTo);
  if (childrenTo !== null) {
    await readCategory(tx, childrenTo);
    if ((await descendantsOf(tx, id)).has(childrenTo))
      throw new AppError("category.reassign_invalid", { field: "childrenTo" });
  }
  // No lock: one write transaction runs on the venue file at a time, so no concurrent route insert
  // can slip between these steps; see the note above `listCategories`.
  await tx
    .update(products)
    .set({ categoryId: productsTo, updatedAt: now() })
    .where(eq(products.categoryId, id));
  // Clears the RESTRICT parent key before the delete below.
  await tx
    .update(categoryDetails)
    .set({ parentId: childrenTo })
    .where(eq(categoryDetails.parentId, id));
  if (await tablePresent(tx, "preparation_routes"))
    await tx.execute(sql`delete from preparation_routes where category_id = ${id}`);
  // category_details cascades via its FK.
  await tx.delete(categories).where(eq(categories.id, id));
}
export interface CategoryDependants {
  /** Every product, variants included, whose OWN main category is this one. */
  products: { id: string; name: string }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}
/** What deleting a category would touch — the preview behind the delete confirmation. */
export async function categoryDependants(tx: Transaction, id: string): Promise<CategoryDependants> {
  const category = await readCategory(tx, id); // 404s an absent id
  const productRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.categoryId, id))
    .orderBy(products.id);
  const childRows = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categoryDetails)
    .innerJoin(categories, eq(categories.id, categoryDetails.categoryId))
    .where(eq(categoryDetails.parentId, id))
    .orderBy(categories.id);
  // Raw SQL, because this joins two other modules' tables by name.
  const routes: CategoryDependants["routes"] = [];
  if (await tablePresent(tx, "preparation_routes")) {
    const routeRows = await tx.execute<{ id: string; station: string | null; zone: string | null }>(
      sql`
      select pr.id,
             case when pr.no_preparation then null else ks.name end as station,
             fz.name as zone
      from preparation_routes pr
      left join kitchen_stations ks on ks.id = pr.station_id
      left join floor_zones fz on fz.id = pr.zone_id
      where pr.category_id = ${id}
      order by pr.id`,
    );
    routes.push(...routeRows.rows);
  }
  return {
    products: productRows,
    children: childRows,
    parentId: category.parentId,
    routes,
  };
}
/**
 * Set a product's main reporting category: any category, or null for Uncategorised. On a variant
 * (reached only with scope `"any"`) null means it follows its parent's.
 */
export async function setMainReportingCategory(
  tx: Transaction,
  productId: string,
  categoryId: string | null,
  scope: ProductScope = "top-level",
): Promise<{ primaryCategoryId: string | null }> {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(productWithId(productId, scope));
  if (!product) throw new AppError("product.not_found", { productId });
  if (categoryId !== null) await readCategory(tx, categoryId);
  await tx
    .update(products)
    .set({ categoryId, updatedAt: now() })
    .where(eq(products.id, product.id));
  return { primaryCategoryId: categoryId };
}
/**
 * Make this category the main category of every listed product, moving each from wherever it was.
 * Resubmitting a product already here is safe and changes nothing but its `updated_at`.
 */
export async function addProductsToCategory(
  tx: Transaction,
  categoryId: string,
  productIds: string[],
): Promise<void> {
  await readCategory(tx, categoryId); // 404s an absent category
  if (!Array.isArray(productIds) || productIds.some((id) => !isUuid(id)))
    throw new AppError("category.membership_invalid", {});
  if (productIds.length === 0) return;
  // Resolve the whole selection in one read, so an unknown, repeated or variant's id is
  // refused before anything is written rather than part-way through a loop: a repeat leaves the
  // count short exactly as an absent id does.
  const found = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, productIds), isTopLevelProduct));
  if (found.length !== productIds.length) throw new AppError("category.membership_invalid", {});
  await tx
    .update(products)
    .set({ categoryId, updatedAt: now() })
    .where(inArray(products.id, productIds));
}
export interface CategoryProduct {
  id: string;
  name: string;
  active: boolean;
  primaryCategoryId: string | null;
  labelIds: string[];
}
/**
 * The top-level products whose main category is this one — or, with `includeDescendants`, this one
 * or any category below it.
 */
export async function listCategoryProducts(
  tx: Transaction,
  categoryId: string,
  opts: { includeDescendants?: boolean } = {},
): Promise<CategoryProduct[]> {
  await readCategory(tx, categoryId);
  const ids = [categoryId];
  if (opts.includeDescendants) ids.push(...(await descendantsOf(tx, categoryId)));
  return tx
    .select({
      id: products.id,
      name: products.name,
      active: products.active,
      primaryCategoryId: products.categoryId,
      labelIds: labelIdArray,
    })
    .from(products)
    .leftJoin(productLabels, labelOwnerJoin)
    .where(and(inArray(products.categoryId, ids), isTopLevelProduct))
    .groupBy(products.id)
    .orderBy(products.id);
}
