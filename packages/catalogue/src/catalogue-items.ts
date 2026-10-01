import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, inArray, sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { categoryDetails } from "./schema/categories.js";
import {
  deleteCategory,
  listCategories,
  tablePresent,
  validateParent,
  type Category,
} from "./categories.js";
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
  products: number;
  routes: number;
}

/** The folder tree, read once: each folder's parent, depth and whole subtree. */
class FolderTree {
  readonly #parent = new Map<string, string | null>();
  constructor(readonly folders: readonly Category[]) {
    for (const { id, parentId } of folders) this.#parent.set(id, parentId);
  }
  require(id: string): void {
    if (!this.#parent.has(id)) throw new AppError("category.not_found", { categoryId: id });
  }
  parent(id: string): string | null {
    return this.#parent.get(id) ?? null;
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
      for (const [child, parent] of this.#parent)
        if (parent === found[i] && !seen.has(child)) {
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
): Promise<void> {
  const tree = await readTree(tx, selection);
  for (const id of selection.productIds) await deactivateProduct(tx, id);
  if (contents === "move_up") {
    for (const id of tree.byDepth(selection.categoryIds, "deepest")) await deleteCategory(tx, id);
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
      await tx
        .update(products)
        .set({ categoryId: parent, updatedAt: now() })
        .where(inArray(products.categoryId, batch));
    }
    for (const folder of tree.byDepth(subtree, "deepest")) {
      await deleteCategory(tx, folder);
      gone.add(folder);
    }
  }
}

export async function summariseFolders(
  tx: Transaction,
  categoryIds: string[],
): Promise<FolderSummary[]> {
  const tree = new FolderTree(await listCategories(tx));
  for (const id of categoryIds) tree.require(id);
  const claimsPresent = await tablePresent(tx, "station_claims");
  const exceptionsPresent = await tablePresent(tx, "route_exceptions");
  const summaries: FolderSummary[] = [];
  for (const id of categoryIds) {
    const subtree = tree.subtree(id);
    let productCount = 0;
    let routeCount = 0;
    for (const batch of batches(subtree)) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(products)
        .where(and(inArray(products.categoryId, batch), isTopLevelProduct));
      productCount += Number(row!.n);
      if (claimsPresent || exceptionsPresent) {
        const folderIds = sql.join(
          batch.map((folder) => sql`${folder}`),
          sql`, `,
        );
        if (claimsPresent) {
          const claims = await tx.execute<{ n: number }>(
            sql`select count(*) as n from station_claims where category_id in (${folderIds})`,
          );
          routeCount += Number(claims.rows[0]!.n);
        }
        if (exceptionsPresent) {
          const exceptions = await tx.execute<{ n: number }>(
            sql`select count(*) as n from route_exceptions where category_id in (${folderIds})`,
          );
          routeCount += Number(exceptions.rows[0]!.n);
        }
      }
    }
    summaries.push({ id, folders: subtree.length - 1, products: productCount, routes: routeCount });
  }
  return summaries;
}
