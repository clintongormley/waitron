import { categories, now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { batches } from "./batches.js";
import { firstNewClash, foldName, type NameEntry } from "./name-uniqueness.js";
import { categoryDetails } from "./schema/categories.js";
import { isTopLevelProduct, productWithId } from "./variant-fallback.js";
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
 * Refuses a write that would leave two categories with one parent sharing a name. `arriving` are
 * the categories the write puts under `parentId`, each with the group `firstNewClash` reads; every
 * other category already there, except the `leaving` ones, counts as staying. `snapshot`, when
 * given, is the whole tree already read in this transaction.
 */
export async function assertCategoryNamesFree(
  tx: Transaction,
  parentId: string | null,
  arriving: readonly (NameEntry & { id: string })[],
  { leaving = [], snapshot }: { leaving?: readonly string[]; snapshot?: readonly Category[] } = {},
): Promise<void> {
  if (arriving.every((category) => category.group === null)) return;
  const ids = new Set([...leaving, ...arriving.map((category) => category.id)]);
  const siblings =
    snapshot?.filter((folder) => folder.parentId === parentId) ??
    (await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
      .where(
        parentId === null
          ? isNull(categoryDetails.parentId)
          : eq(categoryDetails.parentId, parentId),
      ));
  const staying = siblings
    .filter((sibling) => !ids.has(sibling.id))
    .map((sibling) => ({ name: sibling.name, group: null }));
  const clash = firstNewClash([...staying, ...arriving]);
  if (clash) throw new AppError("category.name_taken", { field: "name", name: clash.name });
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
  await assertCategoryNamesFree(tx, input.parentId ?? null, [{ id, name, group: id }]);
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
  const finalName = name ?? current.name;
  const moved = parentId !== current.parentId || foldName(finalName) !== foldName(current.name);
  await assertCategoryNamesFree(tx, parentId, [{ id, name: finalName, group: moved ? id : null }]);
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
export async function deleteCategory(tx: Transaction, id: string): Promise<void> {
  const category = await readCategory(tx, id);
  const children = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categoryDetails)
    .innerJoin(categories, eq(categories.id, categoryDetails.categoryId))
    .where(eq(categoryDetails.parentId, id));
  await assertCategoryNamesFree(
    tx,
    category.parentId,
    children.map((child) => ({ ...child, group: id })),
    { leaving: [id] },
  );
  await vacateCategories(tx, [id], category.parentId);
  // Clears the RESTRICT parent key before the delete below.
  await tx
    .update(categoryDetails)
    .set({ parentId: category.parentId })
    .where(eq(categoryDetails.parentId, id));
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
