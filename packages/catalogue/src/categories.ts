import { categories, products, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE, isUuid } from "@waitron/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { categoryDetails, productCategories } from "./schema/categories.js";
import { validateContentTranslations } from "./content-languages.js";
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
const columns = {
  id: categories.id,
  name: categories.name,
  image: categoryDetails.image,
  color: categoryDetails.color,
  parentId: categoryDetails.parentId,
};

/** Hierarchy edits, membership replacement and deletion share one lock. */
export async function lockCategories(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"categories"}, 0))`);
}
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
  const media = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.media_images') is not null as present`,
  );
  if (!media.rows[0]!.present) throw new AppError("category.image_not_found", {});
  // The media module owns the FK; KEY SHARE holds the reference through a concurrent deletion.
  const image = await tx.execute(
    sql`select 1 from media_images where filename = ${filename} for key share`,
  );
  if (!image.rows.length) throw new AppError("category.image_not_found", {});
}
/**
 * Is the venue-service module's `preparation_routes` table in this database? Routes belong to an
 * optional module, so both the delete and its preview have to ask before naming the table in raw
 * SQL. Follows validateImage's precedent for `media_images`.
 */
async function preparationRoutesPresent(tx: Transaction): Promise<boolean> {
  const table = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.preparation_routes') is not null as present`,
  );
  return table.rows[0]!.present;
}
function validateColor(color: string | null | undefined): void {
  if (color === undefined || color === null) return;
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new AppError("category.color_invalid", {});
}
export async function createCategory(
  tx: Transaction,
  tenantId: string,
  input: CategoryInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<Category> {
  void tenantId;
  await validateContentTranslations(tx, input.name, fallbackLanguage);
  validateColor(input.color);
  await lockCategories(tx);
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
  // Take the content lock before the hierarchy lock, as creation does.
  if (patch.name !== undefined) await validateContentTranslations(tx, patch.name, fallbackLanguage);
  await lockCategories(tx);
  const current = await readCategory(tx, id);
  const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  const image = patch.image === undefined ? current.image : patch.image;
  const color = patch.color === undefined ? current.color : patch.color;
  await validateParent(tx, id, parentId);
  await validateImage(tx, image);
  validateColor(color);
  await tx
    .update(categories)
    .set({ name: patch.name ?? current.name, updatedAt: sql`now()` })
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
  await lockCategories(tx);
  const category = await readCategory(tx, id); // 404s an absent id
  // Lock the identity: route inserts hold its FK's KEY SHARE lock.
  await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .for("update");
  // 1. memberships
  await tx.delete(productCategories).where(eq(productCategories.categoryId, id));
  // 2. clear reporting category where it was this one
  await tx
    .update(products)
    .set({ categoryId: null, updatedAt: sql`now()` })
    .where(eq(products.categoryId, id));
  // 3. reparent direct children to this category's own parent (clears the RESTRICT parent FK)
  await tx
    .update(categoryDetails)
    .set({ parentId: category.parentId })
    .where(eq(categoryDetails.parentId, id));
  // 4. drop preparation routes for this category, if the (optional) venue table exists.
  if (await preparationRoutesPresent(tx))
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
  if (await preparationRoutesPresent(tx)) {
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
export async function readProductCategories(
  tx: Transaction,
  productId: string,
): Promise<ProductCategoryMembership> {
  const [product] = await tx
    .select({
      primaryCategoryId: products.categoryId,
      categoryIds: sql<
        string[]
      >`coalesce(array_agg(${productCategories.categoryId}::text order by ${productCategories.categoryId}) filter (where ${productCategories.categoryId} is not null), array[]::text[])`,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.productId, products.id))
    .where(eq(products.id, productId))
    .groupBy(products.id);
  if (!product) throw new AppError("product.not_found", { productId });
  return product;
}
export async function replaceProductCategories(
  tx: Transaction,
  productId: string,
  input: ProductCategoryInput,
): Promise<ProductCategoryMembership> {
  await lockCategories(tx);
  const current = await readProductCategories(tx, productId);
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
    .set({ categoryId: primary, updatedAt: sql`now()` })
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
  await lockCategories(tx);
  await readCategory(tx, categoryId); // 404s an absent category
  // A coerced non-array, or a malformed id reaching a uuid column, would otherwise surface as a
  // TypeError or a 22P02 — neither of which a route can serve as anything but a 500.
  if (!Array.isArray(productIds) || productIds.some((id) => !isUuid(id)))
    throw new AppError("category.membership_invalid", {});
  if (productIds.length === 0) return;
  // Resolve the whole selection in one read, so an unknown or repeated id is
  // refused before anything is written rather than part-way through a loop: a repeat leaves the
  // count short exactly as an absent id does.
  const found = await tx
    .select({ id: products.id, primaryCategoryId: products.categoryId })
    .from(products)
    .where(inArray(products.id, productIds));
  if (found.length !== productIds.length) throw new AppError("category.membership_invalid", {});
  await tx
    .insert(productCategories)
    .values(productIds.map((productId) => ({ productId, categoryId })))
    .onConflictDoNothing();
  const needReporting = found.filter((p) => p.primaryCategoryId === null).map((p) => p.id);
  if (needReporting.length)
    await tx
      .update(products)
      .set({ categoryId, updatedAt: sql`now()` })
      .where(inArray(products.id, needReporting));
}
export async function listCategoryProducts(tx: Transaction, categoryId: string) {
  await readCategory(tx, categoryId);
  const selected = alias(productCategories, "selected_membership");
  return tx
    .select({
      id: products.id,
      name: products.name,
      active: products.active,
      primaryCategoryId: products.categoryId,
      categoryIds: sql<
        string[]
      >`array_agg(${productCategories.categoryId}::text order by ${productCategories.categoryId})`,
    })
    .from(products)
    .innerJoin(
      selected,
      and(eq(selected.productId, products.id), eq(selected.categoryId, categoryId)),
    )
    .innerJoin(productCategories, eq(productCategories.productId, products.id))

    .groupBy(products.id)
    .orderBy(products.id);
}
