import { categories, products, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE } from "@waitron/shared";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { categoryDetails, productCategories } from "./schema/categories.js";
import { validateContentTranslations } from "./content-languages.js";
import "./errors.js";

export interface Category {
  id: string;
  name: Record<string, string>;
  image: string | null;
  parentId: string | null;
}
export interface CategoryInput {
  name: Record<string, string>;
  image?: string | null;
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
  parentId: categoryDetails.parentId,
};

/** Hierarchy edits, membership replacement and deletion share one tenant lock. */
export async function lockCategories(tx: Transaction, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`categories:${tenantId}`}, 0))`,
  );
}
export async function listCategories(tx: Transaction, tenantId: string): Promise<Category[]> {
  return tx
    .select(columns)
    .from(categories)
    .leftJoin(
      categoryDetails,
      and(
        eq(categoryDetails.tenantId, categories.tenantId),
        eq(categoryDetails.categoryId, categories.id),
      ),
    )
    .where(eq(categories.tenantId, tenantId))
    .orderBy(categories.createdAt, categories.id);
}
export async function readCategory(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<Category> {
  const [row] = await tx
    .select(columns)
    .from(categories)
    .leftJoin(
      categoryDetails,
      and(
        eq(categoryDetails.tenantId, categories.tenantId),
        eq(categoryDetails.categoryId, categories.id),
      ),
    )
    .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
  if (!row) throw new AppError("category.not_found", { categoryId: id });
  return row;
}
async function validateParent(
  tx: Transaction,
  tenantId: string,
  id: string,
  parentId: string | null,
): Promise<void> {
  const seen = new Set([id]);
  while (parentId !== null) {
    if (seen.has(parentId)) throw new AppError("category.parent_cycle", {});
    seen.add(parentId);
    parentId = (await readCategory(tx, tenantId, parentId)).parentId;
  }
}
async function validateImage(
  tx: Transaction,
  tenantId: string,
  filename: string | null,
): Promise<void> {
  if (filename === null) return;
  const media = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.media_images') is not null as present`,
  );
  if (!media.rows[0]!.present) throw new AppError("category.image_not_found", {});
  // The media module owns the FK; KEY SHARE holds the reference through a concurrent deletion.
  const image = await tx.execute(
    sql`select 1 from media_images where tenant_id = ${tenantId} and filename = ${filename} for key share`,
  );
  if (!image.rows.length) throw new AppError("category.image_not_found", {});
}
export async function createCategory(
  tx: Transaction,
  tenantId: string,
  input: CategoryInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<Category> {
  await validateContentTranslations(tx, tenantId, input.name, fallbackLanguage);
  await lockCategories(tx, tenantId);
  const id = crypto.randomUUID();
  await validateParent(tx, tenantId, id, input.parentId ?? null);
  await validateImage(tx, tenantId, input.image ?? null);
  await tx.insert(categories).values({ id, tenantId, name: input.name });
  await tx.insert(categoryDetails).values({
    tenantId,
    categoryId: id,
    parentId: input.parentId ?? null,
    image: input.image ?? null,
  });
  return readCategory(tx, tenantId, id);
}
export async function updateCategory(
  tx: Transaction,
  tenantId: string,
  id: string,
  patch: Partial<CategoryInput>,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<Category> {
  // Take the content lock before the hierarchy lock, as creation does.
  if (patch.name !== undefined)
    await validateContentTranslations(tx, tenantId, patch.name, fallbackLanguage);
  await lockCategories(tx, tenantId);
  const current = await readCategory(tx, tenantId, id);
  const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  const image = patch.image === undefined ? current.image : patch.image;
  await validateParent(tx, tenantId, id, parentId);
  await validateImage(tx, tenantId, image);
  await tx
    .update(categories)
    .set({ name: patch.name ?? current.name, updatedAt: sql`now()` })
    .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
  await tx
    .insert(categoryDetails)
    .values({ tenantId, categoryId: id, parentId, image })
    .onConflictDoUpdate({
      target: [categoryDetails.tenantId, categoryDetails.categoryId],
      set: { parentId, image },
    });
  return readCategory(tx, tenantId, id);
}
export async function deleteCategory(tx: Transaction, tenantId: string, id: string): Promise<void> {
  await lockCategories(tx, tenantId);
  await readCategory(tx, tenantId, id);
  // Lock the identity too: route inserts hold its FK's KEY SHARE lock.
  await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
    .for("update");
  const result = await tx.execute<{ children: number; products: number; routes: number }>(sql`
    select (select count(*)::int from category_details where tenant_id = ${tenantId} and parent_id = ${id}) as children,
    (select count(*)::int from product_categories where tenant_id = ${tenantId} and category_id = ${id}) as products,
    0 as routes`);
  const dependencies = result.rows[0]!;
  // Venue service is optional; catalogue must also work without its route table.
  const routeTable = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.preparation_routes') is not null as present`,
  );
  if (routeTable.rows[0]!.present)
    dependencies.routes = (
      await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from preparation_routes where tenant_id = ${tenantId} and category_id = ${id}`,
      )
    ).rows[0]!.count;
  if (dependencies.children || dependencies.products || dependencies.routes)
    throw new AppError("category.in_use", dependencies);
  await tx.delete(categories).where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
}
export async function readProductCategories(
  tx: Transaction,
  tenantId: string,
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
    .leftJoin(
      productCategories,
      and(
        eq(productCategories.tenantId, products.tenantId),
        eq(productCategories.productId, products.id),
      ),
    )
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .groupBy(products.id);
  if (!product) throw new AppError("product.not_found", { productId });
  return product;
}
export async function replaceProductCategories(
  tx: Transaction,
  tenantId: string,
  productId: string,
  input: ProductCategoryInput,
): Promise<ProductCategoryMembership> {
  await lockCategories(tx, tenantId);
  const current = await readProductCategories(tx, tenantId, productId);
  if (
    !Array.isArray(input.categoryIds) ||
    new Set(input.categoryIds).size !== input.categoryIds.length
  )
    throw new AppError("category.membership_invalid", {});
  for (const id of input.categoryIds) await readCategory(tx, tenantId, id);
  let primary = input.primaryCategoryId;
  if (primary === undefined) {
    if (!input.categoryIds.length) primary = null;
    else if (current.primaryCategoryId === null) primary = input.categoryIds[0]!;
    else if (input.categoryIds.includes(current.primaryCategoryId))
      primary = current.primaryCategoryId;
    else throw new AppError("category.primary_required", {});
  }
  if (
    input.categoryIds.length
      ? primary === null || !input.categoryIds.includes(primary)
      : primary !== null
  )
    throw new AppError("category.membership_invalid", {});
  await tx
    .delete(productCategories)
    .where(
      and(eq(productCategories.tenantId, tenantId), eq(productCategories.productId, productId)),
    );
  if (input.categoryIds.length)
    await tx
      .insert(productCategories)
      .values(input.categoryIds.map((categoryId) => ({ tenantId, productId, categoryId })));
  await tx
    .update(products)
    .set({ categoryId: primary, updatedAt: sql`now()` })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
  return { categoryIds: [...input.categoryIds].sort(), primaryCategoryId: primary };
}
export async function listCategoryProducts(tx: Transaction, tenantId: string, categoryId: string) {
  await readCategory(tx, tenantId, categoryId);
  const selected = alias(productCategories, "selected_membership");
  return tx
    .select({
      id: products.id,
      descriptions: products.descriptions,
      active: products.active,
      primaryCategoryId: products.categoryId,
      categoryIds: sql<
        string[]
      >`array_agg(${productCategories.categoryId}::text order by ${productCategories.categoryId})`,
    })
    .from(products)
    .innerJoin(
      selected,
      and(
        eq(selected.tenantId, products.tenantId),
        eq(selected.productId, products.id),
        eq(selected.categoryId, categoryId),
      ),
    )
    .innerJoin(
      productCategories,
      and(
        eq(productCategories.tenantId, products.tenantId),
        eq(productCategories.productId, products.id),
      ),
    )
    .where(eq(products.tenantId, tenantId))
    .groupBy(products.id)
    .orderBy(products.id);
}
