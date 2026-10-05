import { categories, now, products, tableExists, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { categoryDetails } from "./schema/categories.js";
import { listCategories, vacateCategories, validateParent, type Category } from "./categories.js";
import { assertCategoryNamesFree } from "./category-names.js";
import { deactivateProduct } from "./operations.js";
import { isTopLevelProduct } from "./variant-fallback.js";
import "./errors.js";

export interface CatalogueSelection {
  productIds: string[];
  categoryIds: string[];
}
export type FolderContents = "move_up" | "delete";
export interface FolderSummary {
  id: string;
  folders: number;
  /** Products in the category and every category below it, variants left out, inactive ones
   * included. */
  products: number;
  activeProducts: number;
  /** Routing rules naming the category or any category below it: what deleting its contents too
   * removes. */
  routes: number;
  /** Routing rules naming the category itself: what moving its contents up removes. */
  ownRoutes: number;
}
/**
 * One selected category's counts as the client read them before deleting it (its dialog showed
 * them, when it asked).
 */
export type ShownFolderCounts = Pick<
  FolderSummary,
  "id" | "folders" | "activeProducts" | "routes" | "ownRoutes"
>;

/** The folder tree, read once: each folder's parent, depth and whole subtree. */
class FolderTree {
  readonly #parent = new Map<string, string | null>();
  readonly #children = new Map<string, string[]>();
  constructor(readonly folders: readonly Category[]) {
    for (const { id, parentId } of folders) {
      this.#parent.set(id, parentId);
      if (parentId === null) continue;
      const siblings = this.#children.get(parentId);
      if (siblings === undefined) this.#children.set(parentId, [id]);
      else siblings.push(id);
    }
  }
  require(id: string): void {
    if (!this.#parent.has(id)) throw new AppError("category.not_found", { categoryId: id });
  }
  parent(id: string): string | null {
    return this.#parent.get(id) ?? null;
  }
  /** The nearest folder above `id` that is not in `removed`, or null for the root. */
  survivingParent(id: string, removed: ReadonlySet<string>): string | null {
    const seen = new Set([id]);
    let at = this.parent(id);
    while (at !== null && removed.has(at) && !seen.has(at)) {
      seen.add(at);
      at = this.parent(at);
    }
    return at;
  }
  depth(id: string): number {
    let n = 0;
    const seen = new Set([id]);
    for (let at = this.parent(id); at !== null && !seen.has(at); at = this.parent(at)) {
      seen.add(at);
      n++;
    }
    return n;
  }
  /** `id` and every folder below it. */
  subtree(id: string): string[] {
    const found = [id];
    const seen = new Set(found);
    for (let i = 0; i < found.length; i++)
      for (const child of this.#children.get(found[i]!) ?? [])
        if (!seen.has(child)) {
          seen.add(child);
          found.push(child);
        }
    return found;
  }
  byDepth(ids: readonly string[], order: "deepest" | "shallowest"): string[] {
    const sign = order === "deepest" ? -1 : 1;
    return [...ids].sort((a, b) => sign * (this.depth(a) - this.depth(b)));
  }
}

async function requireTopLevelProducts(tx: Transaction, ids: readonly string[]): Promise<void> {
  const found = new Set<string>();
  for (const batch of batches([...ids]))
    for (const row of await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, batch), isTopLevelProduct)))
      found.add(row.id);
  const missing = ids.find((id) => !found.has(id));
  if (missing !== undefined) throw new AppError("product.not_found", { productId: missing });
}

async function readTree(tx: Transaction, selection: CatalogueSelection): Promise<FolderTree> {
  await requireTopLevelProducts(tx, selection.productIds);
  const tree = new FolderTree(await listCategories(tx));
  for (const id of selection.categoryIds) tree.require(id);
  return tree;
}

export async function moveCatalogueItems(
  tx: Transaction,
  selection: CatalogueSelection,
  to: string | null,
): Promise<void> {
  const tree = await readTree(tx, selection);
  if (to !== null) tree.require(to);
  for (const id of selection.categoryIds) await validateParent(tx, id, to, tree.folders);
  const names = new Map(tree.folders.map((folder) => [folder.id, folder.name]));
  await assertCategoryNamesFree(
    tx,
    [...new Set(selection.categoryIds)].map((id) => ({ id, name: names.get(id)!, parentId: to })),
    { snapshot: tree.folders },
  );
  for (const batch of batches(selection.productIds))
    await tx
      .update(products)
      .set({ categoryId: to, updatedAt: now() })
      .where(inArray(products.id, batch));
  for (const id of selection.categoryIds)
    await tx
      .insert(categoryDetails)
      .values({ categoryId: id, parentId: to })
      .onConflictDoUpdate({ target: categoryDetails.categoryId, set: { parentId: to } });
}

export async function deleteCatalogueItems(
  tx: Transaction,
  selection: CatalogueSelection,
  contents: FolderContents,
  shown?: readonly ShownFolderCounts[],
): Promise<void> {
  const tree = await readTree(tx, selection);
  if (shown !== undefined) await assertContentsAsShown(tx, tree, selection.categoryIds, shown);
  if (contents === "move_up") await assertMovedUpNamesFree(tx, tree, selection.categoryIds);
  for (const id of selection.productIds) await deactivateProduct(tx, id);
  if (contents === "move_up") {
    for (const id of tree.byDepth(selection.categoryIds, "deepest"))
      await removeFolder(tx, id, tree.parent(id));
    return;
  }
  const gone = new Set<string>();
  for (const id of tree.byDepth(selection.categoryIds, "shallowest")) {
    if (gone.has(id)) continue; // inside a selected folder already deleted with its contents
    const parent = tree.parent(id);
    const subtree = tree.subtree(id);
    for (const batch of batches(subtree)) {
      const inside = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.categoryId, batch), isTopLevelProduct));
      for (const product of inside) await deactivateProduct(tx, product.id);
      await vacateCategories(tx, batch, parent);
    }
    for (const folder of tree.byDepth(subtree, "deepest")) {
      await removeFolder(tx, folder, tree.parent(folder));
      gone.add(folder);
    }
  }
}

/**
 * Refuses a deletion that moves contents up when a category it moves would share a name with
 * another in its new parent. Judged once, on the tree as the whole deletion leaves it, so a category
 * the same deletion removes never blocks one moving up past it.
 */
async function assertMovedUpNamesFree(
  tx: Transaction,
  tree: FolderTree,
  removedIds: readonly string[],
): Promise<void> {
  const removed = new Set(removedIds);
  await assertCategoryNamesFree(
    tx,
    tree.folders
      .filter(
        (folder) =>
          !removed.has(folder.id) && folder.parentId !== null && removed.has(folder.parentId),
      )
      .map((folder) => ({ ...folder, parentId: tree.survivingParent(folder.id, removed) })),
    { snapshot: tree.folders, removed: removedIds },
  );
}

async function assertContentsAsShown(
  tx: Transaction,
  tree: FolderTree,
  categoryIds: readonly string[],
  shown: readonly ShownFolderCounts[],
): Promise<void> {
  const byId = new Map(shown.map((counts) => [counts.id, counts]));
  for (const summary of await summarise(tx, tree, categoryIds)) {
    const seen = byId.get(summary.id);
    if (
      seen === undefined ||
      seen.folders !== summary.folders ||
      seen.activeProducts !== summary.activeProducts ||
      seen.routes !== summary.routes ||
      seen.ownRoutes !== summary.ownRoutes
    )
      throw new AppError("category.contents_changed", { categoryId: summary.id });
  }
}

/** Deletes one category, moving its products and the categories under it up to its parent. */
export async function deleteCategory(tx: Transaction, id: string): Promise<void> {
  await deleteCatalogueItems(tx, { productIds: [], categoryIds: [id] }, "move_up");
}

/**
 * Deletes `id`, moving what it holds up to `parent`, its parent now: the deletions above run
 * deepest first, so a folder's parent is still in place when the folder goes.
 */
async function removeFolder(tx: Transaction, id: string, parent: string | null): Promise<void> {
  await vacateCategories(tx, [id], parent);
  // Clears the RESTRICT parent key before the delete below.
  await tx
    .update(categoryDetails)
    .set({ parentId: parent })
    .where(eq(categoryDetails.parentId, id));
  // category_details cascades via its FK.
  await tx.delete(categories).where(eq(categories.id, id));
}

export async function summariseFolders(
  tx: Transaction,
  categoryIds: string[],
): Promise<FolderSummary[]> {
  const tree = new FolderTree(await listCategories(tx));
  for (const id of categoryIds) tree.require(id);
  return summarise(tx, tree, categoryIds);
}

/** Counts each folder's own contents once, however many selected subtrees share it, then sums
 * per subtree, so a selected category inside another selected one counts its contents in both. */
async function summarise(
  tx: Transaction,
  tree: FolderTree,
  categoryIds: readonly string[],
): Promise<FolderSummary[]> {
  const subtrees = categoryIds.map((id) => tree.subtree(id));
  const counts = new Map(
    subtrees.flat().map((id) => [id, { products: 0, activeProducts: 0, routes: 0 }]),
  );
  const claimsPresent = await tableExists(tx, "station_claims");
  const exceptionsPresent = await tableExists(tx, "route_exceptions");
  for (const batch of batches([...counts.keys()])) {
    for (const row of await tx
      .select({
        categoryId: products.categoryId,
        n: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${eq(products.active, true)})`,
      })
      .from(products)
      .where(and(inArray(products.categoryId, batch), isTopLevelProduct))
      .groupBy(products.categoryId)) {
      const entry = counts.get(row.categoryId!)!;
      entry.products += Number(row.n);
      entry.activeProducts += Number(row.active);
    }
    const inBatch = sql.join(
      batch.map((folder) => sql`${folder}`),
      sql`, `,
    );
    for (const [present, table] of [
      [claimsPresent, sql`station_claims`],
      [exceptionsPresent, sql`route_exceptions`],
    ] as const) {
      if (!present) continue;
      const routes = await tx.execute<{ category_id: string; n: number }>(
        sql`select category_id, count(*) as n from ${table} where category_id in (${inBatch}) group by category_id`,
      );
      for (const row of routes.rows) counts.get(row.category_id)!.routes += Number(row.n);
    }
  }
  return subtrees.map((subtree) => {
    const summary = {
      id: subtree[0]!,
      folders: subtree.length - 1,
      products: 0,
      activeProducts: 0,
      routes: 0,
      ownRoutes: counts.get(subtree[0]!)!.routes,
    };
    for (const folder of subtree) {
      const entry = counts.get(folder)!;
      summary.products += entry.products;
      summary.activeProducts += entry.activeProducts;
      summary.routes += entry.routes;
    }
    return summary;
  });
}
