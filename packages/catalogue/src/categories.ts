import { categories, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { batches } from "./batches.js";
import { assertCategoryNamesFree } from "./category-names.js";
import { foldName } from "./name-uniqueness.js";
import { isStoredColor } from "./color-inheritance.js";
import { categoryDetails } from "./schema/categories.js";
import { isTopLevelProduct, productWithId } from "./variant-fallback.js";
import "./errors.js";

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
}
export interface CategoryInput {
  name: string;
  parentId?: string | null;
  color?: string | null;
}
const columns = {
  id: categories.id,
  name: categories.name,
  parentId: categoryDetails.parentId,
  color: categoryDetails.color,
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
function categoryName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") throw new AppError("category.invalid", { field: "name" });
  return trimmed;
}
function categoryColorInput(value: unknown): string | null {
  if (value === null) return null;
  if (!isStoredColor(value)) throw new AppError("category.invalid", { field: "color" });
  return value;
}
export async function createCategory(tx: Transaction, input: CategoryInput): Promise<Category> {
  const name = categoryName(input.name);
  const color = input.color === undefined ? null : categoryColorInput(input.color);
  const id = crypto.randomUUID();
  await validateParent(tx, id, input.parentId ?? null);
  await assertCategoryNamesFree(tx, [{ id, name, parentId: input.parentId ?? null }]);
  await tx.insert(categories).values({ id, name });
  await tx
    .insert(categoryDetails)
    .values({ categoryId: id, parentId: input.parentId ?? null, color });
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
  const color = patch.color === undefined ? current.color : categoryColorInput(patch.color);
  await validateParent(tx, id, parentId);
  const finalName = name ?? current.name;
  if (parentId !== current.parentId || foldName(finalName) !== foldName(current.name))
    await assertCategoryNamesFree(tx, [{ id, name: finalName, parentId }]);
  await tx
    .update(categories)
    .set({ name: finalName, updatedAt: now() })
    .where(eq(categories.id, id));
  await tx
    .insert(categoryDetails)
    .values({ categoryId: id, parentId, color })
    .onConflictDoUpdate({ target: categoryDetails.categoryId, set: { parentId, color } });
  return readCategory(tx, id);
}
/**
 * Empties categories about to be deleted: the products in them move to `to`, and a variant still
 * storing one of them has it cleared, since a variant reads its parent's category whatever it stores
 * and must not keep a key to a deleted row.
 */
export async function vacateCategories(
  tx: Transaction,
  ids: string[],
  to: string | null,
): Promise<void> {
  await tx
    .update(products)
    .set({ categoryId: to, updatedAt: now() })
    .where(and(inArray(products.categoryId, ids), isTopLevelProduct));
  await tx
    .update(products)
    .set({ categoryId: null, updatedAt: now() })
    .where(and(inArray(products.categoryId, ids), isNotNull(products.parentId)));
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
 * Set a product's main reporting category: any category, or null for Uncategorised. A variant has
 * none of its own (it always reads its parent's), so its id answers as an id that names no product.
 */
export async function setMainReportingCategory(
  tx: Transaction,
  productId: string,
  categoryId: string | null,
): Promise<{ primaryCategoryId: string | null }> {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(productWithId(productId, "top-level"));
  if (!product) throw new AppError("product.not_found", { productId });
  if (categoryId !== null) await readCategory(tx, categoryId);
  await tx
    .update(products)
    .set({ categoryId, updatedAt: now() })
    .where(eq(products.id, product.id));
  return { primaryCategoryId: categoryId };
}
