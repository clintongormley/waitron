import { eq, inArray } from "drizzle-orm";
import { categories, products, type Transaction } from "@waitron/db";
import { AppError, type ClassificationEntry, type SaleLineClassification } from "@waitron/shared";
import { categoryDetails } from "./schema/categories.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";
import "./errors.js";

/** The reporting tree, and the listed products' main categories, read once for a sale. */
export interface LoadedClassification {
  /** Every reporting category: its name and its parent. */
  categories: ReadonlyMap<string, { name: string; parentId: string | null }>;
  /** Each loaded product: its main category after the variant fallback. */
  products: ReadonlyMap<string, { categoryId: string | null }>;
}

/**
 * Reads what `classifyLine` needs for every product in `productIds`, in two queries however many
 * products there are.
 */
export async function loadClassification(
  tx: Transaction,
  productIds: readonly string[],
): Promise<LoadedClassification> {
  const productRows = await tx
    .select({ id: products.id, categoryId: effectiveProductColumns.categoryId })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.id, [...productIds]));
  const categoryRows = await tx
    .select({ id: categories.id, name: categories.name, parentId: categoryDetails.parentId })
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id));
  return {
    categories: new Map(
      categoryRows.map((row) => [row.id, { name: row.name, parentId: row.parentId }]),
    ),
    products: new Map(productRows.map((row) => [row.id, { categoryId: row.categoryId }])),
  };
}

function loadedProduct(c: LoadedClassification, productId: string) {
  const product = c.products.get(productId);
  if (product === undefined) throw new AppError("product.not_found", { productId });
  return product;
}

/**
 * The snapshot a sale line records for `productId`: its main reporting chain from the root to the
 * leaf (empty when Uncategorised), each category with its name now. Checked by `validateSnapshot`
 * before it is returned.
 */
export function classifyLine(c: LoadedClassification, productId: string): SaleLineClassification {
  const product = loadedProduct(c, productId);
  const reporting: ClassificationEntry[] = [];
  // Bounded by the tree's size, so a loop in the data ends with a repeated id that validation
  // refuses rather than a walk that never ends.
  for (
    let id = product.categoryId;
    id !== null && reporting.length <= c.categories.size;
    id = c.categories.get(id)?.parentId ?? null
  ) {
    reporting.unshift({ id, name: c.categories.get(id)?.name ?? "" });
  }
  const snapshot = { reporting };
  validateSnapshot(c, productId, snapshot);
  return snapshot;
}

/**
 * Refuses a snapshot with `sale_classification.invalid` unless every id names a loaded category,
 * every name is non-empty, the chain repeats no category, and it ends at the product's main
 * reporting category (is empty when it has none).
 */
export function validateSnapshot(
  c: LoadedClassification,
  productId: string,
  snapshot: SaleLineClassification,
): void {
  const refuse = (reason: "unknown_id" | "empty_name" | "repeated_id" | "wrong_leaf") => {
    throw new AppError("sale_classification.invalid", { productId, reason });
  };
  const product = loadedProduct(c, productId);
  if (snapshot.reporting.some((entry) => !c.categories.has(entry.id))) refuse("unknown_id");
  if (snapshot.reporting.some((entry) => entry.name === "")) refuse("empty_name");
  if (new Set(snapshot.reporting.map((entry) => entry.id)).size !== snapshot.reporting.length)
    refuse("repeated_id");
  if ((snapshot.reporting.at(-1)?.id ?? null) !== product.categoryId) refuse("wrong_leaf");
}
