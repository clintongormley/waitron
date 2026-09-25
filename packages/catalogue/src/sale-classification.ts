import { eq, inArray } from "drizzle-orm";
import { categories, products, type Transaction } from "@waitron/db";
import {
  AppError,
  resolveContentText,
  type ClassificationEntry,
  type SaleLineClassification,
} from "@waitron/shared";
import { labelIdArray } from "./labels.js";
import { categoryDetails } from "./schema/categories.js";
import { labels, productLabels } from "./schema/labels.js";
import {
  effectiveProductColumns,
  labelOwnerJoin,
  parentJoin,
  parentProducts,
} from "./variant-fallback.js";
import "./errors.js";

/** The reporting tree, and the listed products' classification and labels, read once for a sale. */
export interface LoadedClassification {
  /** Every reporting category: its name in every language it has, and its parent. */
  categories: ReadonlyMap<string, { name: Record<string, string>; parentId: string | null }>;
  /** The language a walked category's name is resolved in. */
  language: string;
  /** The name of every label a loaded product carries. */
  labels: ReadonlyMap<string, string>;
  /** Each loaded product: a variant's parent, its main category after the variant fallback, and
   * the ids of the labels it carries (a variant's are its parent's), sorted. */
  products: ReadonlyMap<
    string,
    { parentId: string | null; categoryId: string | null; labelIds: readonly string[] }
  >;
}

/**
 * Reads what `classifyLine` needs for every product in `productIds`, in three queries however many
 * products there are. A category's name is resolved only when `classifyLine` walks it, in
 * `defaultLanguage`, the language the line's free-text `category` is resolved in.
 */
export async function loadClassification(
  tx: Transaction,
  productIds: readonly string[],
  defaultLanguage: string,
): Promise<LoadedClassification> {
  const productRows = await tx
    .select({
      id: products.id,
      parentId: products.parentId,
      categoryId: effectiveProductColumns.categoryId,
      labelIds: labelIdArray,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productLabels, labelOwnerJoin)
    .where(inArray(products.id, [...productIds]))
    .groupBy(products.id);
  const labelRows = await tx
    .select({ id: labels.id, name: labels.name })
    .from(labels)
    .where(inArray(labels.id, [...new Set(productRows.flatMap((row) => row.labelIds))]));
  const categoryRows = await tx
    .select({ id: categories.id, name: categories.name, parentId: categoryDetails.parentId })
    .from(categories)
    .leftJoin(categoryDetails, eq(categoryDetails.categoryId, categories.id));
  return {
    categories: new Map(
      categoryRows.map((row) => [row.id, { name: row.name, parentId: row.parentId }]),
    ),
    language: defaultLanguage,
    labels: new Map(labelRows.map((row) => [row.id, row.name])),
    products: new Map(
      productRows.map((row) => [
        row.id,
        { parentId: row.parentId, categoryId: row.categoryId, labelIds: row.labelIds },
      ]),
    ),
  };
}

function loadedProduct(c: LoadedClassification, productId: string) {
  const product = c.products.get(productId);
  if (product === undefined) throw new AppError("product.not_found", { productId });
  return product;
}

/** A variant's parent product, or null for a product in its own right. */
export function parentProductOf(c: LoadedClassification, productId: string): string | null {
  return loadedProduct(c, productId).parentId;
}

/**
 * The snapshot a sale line records for `productId`: its main reporting chain from the root to the
 * leaf (empty when Uncategorised) and its labels by id, each with its name now. Checked by
 * `validateSnapshot` before it is returned.
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
    const category = c.categories.get(id);
    reporting.unshift({
      id,
      name: category === undefined ? "" : resolveContentText(category.name, c.language, c.language),
    });
  }
  const snapshot = {
    reporting,
    labels: product.labelIds.map((id) => ({ id, name: c.labels.get(id) ?? "" })),
  };
  validateSnapshot(c, productId, snapshot);
  return snapshot;
}

/**
 * Refuses a snapshot with `sale_classification.invalid` unless every id names a loaded category or
 * label, every name is non-empty, the chain repeats no category, and it ends at the product's main
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
  if (
    snapshot.reporting.some((entry) => !c.categories.has(entry.id)) ||
    snapshot.labels.some((entry) => !c.labels.has(entry.id))
  )
    refuse("unknown_id");
  if ([...snapshot.reporting, ...snapshot.labels].some((entry) => entry.name === ""))
    refuse("empty_name");
  if (new Set(snapshot.reporting.map((entry) => entry.id)).size !== snapshot.reporting.length)
    refuse("repeated_id");
  if ((snapshot.reporting.at(-1)?.id ?? null) !== product.categoryId) refuse("wrong_leaf");
}
