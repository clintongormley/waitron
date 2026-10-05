import { categories, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq, isNull } from "drizzle-orm";
import type { Category } from "./categories.js";
import { firstNewClash, foldName } from "./name-uniqueness.js";
import { categoryDetails } from "./schema/categories.js";
import "./errors.js";

type NamedCategory = Pick<Category, "id" | "name" | "parentId">;

/** The categories directly under `parentId`; null is the root, which holds a category stored with
 * no details row too. */
async function categoriesUnder(tx: Transaction, parentId: string | null): Promise<NamedCategory[]> {
  return tx
    .select({ id: categories.id, name: categories.name, parentId: categoryDetails.parentId })
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id))
    .where(
      parentId === null ? isNull(categoryDetails.parentId) : eq(categoryDetails.parentId, parentId),
    );
}

/**
 * Refuses a write that would leave two categories with one parent sharing a name. `placed` are the
 * categories the write creates, renames or moves, each as the write leaves it; `removed` the ones
 * it deletes. A placed category counts as changed unless it keeps its stored parent and folded
 * name, so a category arriving in a parent meets everything already there, while categories that
 * already shared a name and stay put do not block the write (`firstNewClash`). `snapshot`, when
 * given, is the whole tree already read in this transaction; absent, each destination is read.
 */
export async function assertCategoryNamesFree(
  tx: Transaction,
  placed: readonly NamedCategory[],
  {
    snapshot,
    removed = [],
  }: { snapshot?: readonly NamedCategory[]; removed?: readonly string[] } = {},
): Promise<void> {
  const leaving = new Set([...removed, ...placed.map((category) => category.id)]);
  const tree = snapshot && new Map(snapshot.map((folder) => [folder.id, folder]));
  for (const parentId of new Set(placed.map((category) => category.parentId))) {
    const there =
      snapshot?.filter((folder) => folder.parentId === parentId) ??
      (await categoriesUnder(tx, parentId));
    const stored = tree ?? new Map(there.map((folder) => [folder.id, folder]));
    const clash = firstNewClash([
      ...there
        .filter((folder) => !leaving.has(folder.id))
        .map((folder) => ({ name: folder.name, changed: false })),
      ...placed
        .filter((category) => category.parentId === parentId)
        .map((category) => {
          const was = stored.get(category.id);
          const changed =
            was === undefined ||
            was.parentId !== category.parentId ||
            foldName(was.name) !== foldName(category.name);
          return { name: category.name, changed };
        }),
    ]);
    if (clash) throw new AppError("category.name_taken", { field: "name", name: clash.name });
  }
}
