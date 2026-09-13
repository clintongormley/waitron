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
  await validateContentTranslations(tx, tenantId, input.name, fallbackLanguage);
  validateColor(input.color);
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
    color: input.color ?? null,
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
  const color = patch.color === undefined ? current.color : patch.color;
  await validateParent(tx, tenantId, id, parentId);
  await validateImage(tx, tenantId, image);
  validateColor(color);
  await tx
    .update(categories)
    .set({ name: patch.name ?? current.name, updatedAt: sql`now()` })
    .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
  await tx
    .insert(categoryDetails)
    .values({ tenantId, categoryId: id, parentId, image, color })
    .onConflictDoUpdate({
      target: [categoryDetails.tenantId, categoryDetails.categoryId],
      set: { parentId, image, color },
    });
  return readCategory(tx, tenantId, id);
}
export async function deleteCategory(tx: Transaction, tenantId: string, id: string): Promise<void> {
  await lockCategories(tx, tenantId);
  const category = await readCategory(tx, tenantId, id); // 404s a foreign/absent id, tenant-scoped
  // Lock the identity: route inserts hold its FK's KEY SHARE lock.
  await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
    .for("update");
  // 1. memberships
  await tx
    .delete(productCategories)
    .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.categoryId, id)));
  // 2. clear reporting category where it was this one
  await tx
    .update(products)
    .set({ categoryId: null, updatedAt: sql`now()` })
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, id)));
  // 3. reparent direct children to this category's own parent (clears the RESTRICT parent FK)
  await tx
    .update(categoryDetails)
    .set({ parentId: category.parentId })
    .where(and(eq(categoryDetails.tenantId, tenantId), eq(categoryDetails.parentId, id)));
  // 4. drop preparation routes for this category, if the (optional) venue table exists.
  // Raw SQL and the to_regclass guard follow validateImage's precedent for optional module tables.
  const routeTable = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.preparation_routes') is not null as present`,
  );
  if (routeTable.rows[0]!.present)
    await tx.execute(
      sql`delete from preparation_routes where tenant_id = ${tenantId} and category_id = ${id}`,
    );
  // 5. the category row (category_details cascades via its FK)
  await tx.delete(categories).where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
}
export interface CategoryDependants {
  products: { id: string; name: Record<string, string>; reporting: boolean }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}
/** What deleting a category would touch — the preview behind the delete confirmation. */
export async function categoryDependants(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<CategoryDependants> {
  const category = await readCategory(tx, tenantId, id); // 404s a foreign/absent id, tenant-scoped
  const productRows = await tx
    .select({ id: products.id, name: products.descriptions, primary: products.categoryId })
    .from(products)
    .innerJoin(
      productCategories,
      and(
        eq(productCategories.tenantId, products.tenantId),
        eq(productCategories.productId, products.id),
        eq(productCategories.categoryId, id),
      ),
    )
    .where(eq(products.tenantId, tenantId))
    .orderBy(products.id);
  const childRows = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categoryDetails)
    .innerJoin(
      categories,
      and(
        eq(categories.tenantId, categoryDetails.tenantId),
        eq(categories.id, categoryDetails.categoryId),
      ),
    )
    .where(and(eq(categoryDetails.tenantId, tenantId), eq(categoryDetails.parentId, id)))
    .orderBy(categories.id);
  // Routes live in the optional venue-service module; guard the query on the table's presence,
  // as validateImage does for media_images. Raw SQL joins two other modules' tables by name.
  const routes: CategoryDependants["routes"] = [];
  const routeTable = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('public.preparation_routes') is not null as present`,
  );
  if (routeTable.rows[0]!.present) {
    const routeRows = await tx.execute<{ id: string; station: string | null; zone: string | null }>(
      sql`
      select pr.id,
             case when pr.no_preparation then null else ks.name end as station,
             fz.name as zone
      from preparation_routes pr
      left join kitchen_stations ks on ks.tenant_id = pr.tenant_id and ks.id = pr.station_id
      left join floor_zones fz on fz.tenant_id = pr.tenant_id and fz.id = pr.zone_id
      where pr.tenant_id = ${tenantId} and pr.category_id = ${id}
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
  if (primary !== null && !input.categoryIds.includes(primary))
    throw new AppError("category.membership_invalid", {});
  if (input.categoryIds.length === 0 && primary !== null)
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
