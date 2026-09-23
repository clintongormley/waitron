import { categories, now, products, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE, isUuid } from "@waitron/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { categoryDetails, productCategories } from "./schema/categories.js";
import { validateContentTranslations } from "./content-languages.js";
import { isTopLevelProduct, productWithId, type ProductScope } from "./variant-fallback.js";
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
export interface ProductCategoryMembership {
  categoryIds: string[];
  primaryCategoryId: string | null;
}
export interface ProductCategoryInput {
  categoryIds: string[];
  primaryCategoryId?: string | null;
}
/**
 * A product's category ids, gathered in one column and decoded to an array.
 *
 * `json_group_array` is what SQLite has in place of `array_agg`, and the driver hands back the JSON
 * TEXT it built, never a JavaScript array — the `.mapWith` parses it, so a caller gets the array.
 * Measured on SQLite 3.53.4 (Node v26.7.0): with the `filter` removing every row the aggregate
 * returns the string `[]`, not null, which is why the `coalesce` that wrapped the PostgreSQL form is
 * gone rather than translated. The filter itself stays, because a product with no membership
 * reaches this through a left join and would otherwise gather one null.
 */
export const categoryIdArray =
  sql`json_group_array(${productCategories.categoryId} order by ${productCategories.categoryId}) filter (where ${productCategories.categoryId} is not null)`.mapWith(
    (value: string): string[] => JSON.parse(value) as string[],
  );

const columns = {
  id: categories.id,
  name: categories.name,
  image: categoryDetails.image,
  color: categoryDetails.color,
  parentId: categoryDetails.parentId,
};

/*
 * Hierarchy edits, membership replacement and deletion used to share one advisory lock, taken as
 * the first statement of each. There is nothing left for it to arrange: `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside the venue file's write queue, which admits
 * one write transaction at a time (`packages/store/src/write-queue.ts`), so two of these paths
 * cannot overlap however they are started. Receipt: `racePair` in
 * `packages/catalogue/test/fixtures.ts`, which carries the measurement and its control, and the
 * three `serializes …` cases in `categories.db.test.ts` that use it.
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
async function validateImage(tx: Transaction, filename: string | null): Promise<void> {
  if (filename === null) return;
  if (!(await tablePresent(tx, "media_images"))) throw new AppError("category.image_not_found", {});
  // The media module owns the foreign key. The row cannot be deleted between this read and the
  // write that depends on it: one write transaction runs on the venue file at a time, so there is
  // no concurrent deleter to hold the reference against.
  const image = await tx.execute(sql`select 1 from media_images where filename = ${filename}`);
  if (!image.rows.length) throw new AppError("category.image_not_found", {});
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
  // Validate the translations before reading the hierarchy, as creation does. Neither step takes
  // a lock any more: one write transaction runs on the venue file at a time.
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
export async function deleteCategory(tx: Transaction, id: string): Promise<void> {
  const category = await readCategory(tx, id); // 404s an absent id
  // The identity used to be locked here, so that a concurrent route insert holding its foreign
  // key could not slip between this delete's steps. One write transaction runs on the venue file
  // at a time, so no other writer exists to race; see the note beside this file's imports.
  // 1. memberships
  await tx.delete(productCategories).where(eq(productCategories.categoryId, id));
  // 2. clear reporting category where it was this one
  await tx
    .update(products)
    .set({ categoryId: null, updatedAt: now() })
    .where(eq(products.categoryId, id));
  // 3. reparent direct children to this category's own parent (clears the RESTRICT parent FK)
  await tx
    .update(categoryDetails)
    .set({ parentId: category.parentId })
    .where(eq(categoryDetails.parentId, id));
  // 4. drop preparation routes for this category, if the (optional) venue table exists.
  if (await tablePresent(tx, "preparation_routes"))
    await tx.execute(sql`delete from preparation_routes where category_id = ${id}`);
  // 5. the category row (category_details cascades via its FK)
  await tx.delete(categories).where(eq(categories.id, id));
}
export interface CategoryDependants {
  products: { id: string; name: string; reporting: boolean }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}
/** What deleting a category would touch — the preview behind the delete confirmation. */
export async function categoryDependants(tx: Transaction, id: string): Promise<CategoryDependants> {
  const category = await readCategory(tx, id); // 404s an absent id
  const productRows = await tx
    .select({ id: products.id, name: products.name, primary: products.categoryId })
    .from(products)
    .innerJoin(
      productCategories,
      and(eq(productCategories.productId, products.id), eq(productCategories.categoryId, id)),
    )
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
    products: productRows.map((p) => ({ id: p.id, name: p.name, reporting: p.primary === id })),
    children: childRows,
    parentId: category.parentId,
    routes,
  };
}
/** A product's OWN memberships: a variant with none inherits its parent's (V12). */
export async function readProductCategories(
  tx: Transaction,
  productId: string,
  scope: ProductScope = "top-level",
): Promise<ProductCategoryMembership> {
  const [product] = await tx
    .select({
      primaryCategoryId: products.categoryId,
      categoryIds: categoryIdArray,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.productId, products.id))
    .where(productWithId(productId, scope))
    .groupBy(products.id);
  if (!product) throw new AppError("product.not_found", { productId });
  return product;
}
/** Replace a product's own memberships; on a variant, an empty set returns it to inheriting. */
export async function replaceProductCategories(
  tx: Transaction,
  productId: string,
  input: ProductCategoryInput,
  scope: ProductScope = "top-level",
): Promise<ProductCategoryMembership> {
  const current = await readProductCategories(tx, productId, scope);
  if (
    !Array.isArray(input.categoryIds) ||
    new Set(input.categoryIds).size !== input.categoryIds.length
  )
    throw new AppError("category.membership_invalid", {});
  for (const id of input.categoryIds) await readCategory(tx, id);
  // A reporting category is optional. When omitted, keep a surviving current one, fall back to the
  // first submitted id only when there was none, and otherwise leave it cleared.
  let primary = input.primaryCategoryId;
  if (primary === undefined) {
    if (!input.categoryIds.length) primary = null;
    else if (current.primaryCategoryId === null) primary = input.categoryIds[0]!;
    else if (input.categoryIds.includes(current.primaryCategoryId))
      primary = current.primaryCategoryId;
    else primary = null;
  }
  // Covers a primary sent with an EMPTY set too: nothing is in an empty array, so the `includes`
  // check below is what rejects that case.
  if (primary !== null && !input.categoryIds.includes(primary))
    throw new AppError("category.membership_invalid", {});
  await tx.delete(productCategories).where(eq(productCategories.productId, productId));
  if (input.categoryIds.length)
    await tx
      .insert(productCategories)
      .values(input.categoryIds.map((categoryId) => ({ productId, categoryId })));
  await tx
    .update(products)
    .set({ categoryId: primary, updatedAt: now() })
    .where(eq(products.id, productId));
  return { categoryIds: [...input.categoryIds].sort(), primaryCategoryId: primary };
}
/**
 * Add many products to one category. A product with no reporting category gets this one; a product
 * that already has one keeps it. Resubmitting a product that is already a member is safe — it never
 * fails and never duplicates the membership — but it is not a no-op: the reporting category is
 * chosen from the product's own current value, not from whether the membership is new, so an
 * existing member that still has no reporting category is given this one. Only an existing member
 * that already has a reporting category comes out unchanged.
 */
export async function addProductsToCategory(
  tx: Transaction,
  categoryId: string,
  productIds: string[],
): Promise<void> {
  await readCategory(tx, categoryId); // 404s an absent category
  // A coerced non-array, or a malformed id reaching a uuid column, would otherwise surface as a
  // TypeError or a 22P02 — neither of which a route can serve as anything but a 500.
  if (!Array.isArray(productIds) || productIds.some((id) => !isUuid(id)))
    throw new AppError("category.membership_invalid", {});
  if (productIds.length === 0) return;
  // Resolve the whole selection in one read, so an unknown, repeated or variant's id is
  // refused before anything is written rather than part-way through a loop: a repeat leaves the
  // count short exactly as an absent id does.
  const found = await tx
    .select({ id: products.id, primaryCategoryId: products.categoryId })
    .from(products)
    .where(and(inArray(products.id, productIds), isTopLevelProduct));
  if (found.length !== productIds.length) throw new AppError("category.membership_invalid", {});
  await tx
    .insert(productCategories)
    .values(productIds.map((productId) => ({ productId, categoryId })))
    .onConflictDoNothing();
  const needReporting = found.filter((p) => p.primaryCategoryId === null).map((p) => p.id);
  if (needReporting.length)
    await tx
      .update(products)
      .set({ categoryId, updatedAt: now() })
      .where(inArray(products.id, needReporting));
}
export async function listCategoryProducts(tx: Transaction, categoryId: string) {
  await readCategory(tx, categoryId);
  const selected = alias(productCategories, "selected_membership");
  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      active: products.active,
      primaryCategoryId: products.categoryId,
      categoryIds: categoryIdArray,
    })
    .from(products)
    .innerJoin(
      selected,
      and(eq(selected.productId, products.id), eq(selected.categoryId, categoryId)),
    )
    .innerJoin(productCategories, eq(productCategories.productId, products.id))
    .groupBy(products.id)
    .orderBy(products.id);
  return rows;
}
