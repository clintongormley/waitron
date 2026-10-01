import { categories, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { categoryDetails } from "./schema/categories.js";
import { isTopLevelProduct, productWithId, type ProductScope } from "./variant-fallback.js";
import "./errors.js";

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
}
export interface CategoryInput {
  name: string;
  parentId?: string | null;
}
const columns = {
  id: categories.id,
  name: categories.name,
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
export async function validateParent(
  tx: Transaction,
  id: string,
  parentId: string | null,
  snapshot?: readonly Category[],
): Promise<void> {
  const byId =
    snapshot === undefined ? undefined : new Map(snapshot.map((folder) => [folder.id, folder]));
  const seen = new Set([id]);
  while (parentId !== null) {
    if (seen.has(parentId)) throw new AppError("category.parent_cycle", {});
    seen.add(parentId);
    const parent = byId === undefined ? await readCategory(tx, parentId) : byId.get(parentId);
    if (parent === undefined) throw new AppError("category.not_found", { categoryId: parentId });
    parentId = parent.parentId;
  }
}
/**
 * Has an optional module's table been migrated into this database?
 *
 * `media_images` and `preparation_routes` both belong to modules a venue need not have, so every
 * path that names one in raw SQL asks first. The count is read rather than a boolean expression:
 * this is a raw statement, so no drizzle column mapping runs over the result and SQLite has no
 * boolean type — a `... is not null` expression comes back as the number 1 or 0.
 */
export async function tablePresent(tx: Transaction, name: string): Promise<boolean> {
  const found = await tx.execute<{ n: number }>(
    sql`select count(*) as n from sqlite_master where type = 'table' and name = ${name}`,
  );
  return found.rows[0]!.n > 0;
}
function categoryName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") throw new AppError("category.invalid", { field: "name" });
  return trimmed;
}
export async function createCategory(tx: Transaction, input: CategoryInput): Promise<Category> {
  const name = categoryName(input.name);
  const id = crypto.randomUUID();
  await validateParent(tx, id, input.parentId ?? null);
  await tx.insert(categories).values({ id, name });
  await tx.insert(categoryDetails).values({ categoryId: id, parentId: input.parentId ?? null });
  return readCategory(tx, id);
}
export async function updateCategory(
  tx: Transaction,
  id: string,
  patch: Partial<CategoryInput>,
): Promise<Category> {
  const name = patch.name === undefined ? undefined : categoryName(patch.name);
  const current = await readCategory(tx, id);
  const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  await validateParent(tx, id, parentId);
  await tx
    .update(categories)
    .set({ name: name ?? current.name, updatedAt: now() })
    .where(eq(categories.id, id));
  await tx
    .insert(categoryDetails)
    .values({ categoryId: id, parentId })
    .onConflictDoUpdate({ target: categoryDetails.categoryId, set: { parentId } });
  return readCategory(tx, id);
}
export async function deleteCategory(tx: Transaction, id: string): Promise<void> {
  const category = await readCategory(tx, id);
  // No lock: one write transaction runs on the venue file at a time, so no concurrent route insert
  // can slip between these steps; see the note above `listCategories`.
  await tx
    .update(products)
    .set({ categoryId: category.parentId, updatedAt: now() })
    .where(eq(products.categoryId, id));
  // Clears the RESTRICT parent key before the delete below.
  await tx
    .update(categoryDetails)
    .set({ parentId: category.parentId })
    .where(eq(categoryDetails.parentId, id));
  if (await tablePresent(tx, "preparation_routes"))
    await tx.execute(sql`delete from preparation_routes where category_id = ${id}`);
  // category_details cascades via its FK.
  await tx.delete(categories).where(eq(categories.id, id));
}
/** Are these all distinct top-level products? A repeat leaves the count short, as an absent id does. */
export async function allTopLevelProducts(
  tx: Transaction,
  ids: readonly unknown[],
): Promise<boolean> {
  if (ids.some((id) => typeof id !== "string")) return false;
  // Counted as a set, so a repeat in a later batch than its first still leaves the count short.
  const found = new Set<string>();
  for (const batch of batches(ids as string[])) {
    const rows = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, batch), isTopLevelProduct));
    for (const row of rows) found.add(row.id);
  }
  return found.size === ids.length;
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
