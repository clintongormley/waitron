import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { labels, productLabels } from "./schema/labels.js";
import "./errors.js";

export interface Label {
  id: string;
  name: string;
}
export interface LabelSummary extends Label {
  /** How many products carry the label. A variant carries none of its own, so it is not counted. */
  productCount: number;
}

/**
 * A product's label ids, gathered in one column and decoded to an array. The driver hands back the
 * JSON TEXT `json_group_array` built, which `.mapWith` parses; the `filter` keeps a product with no
 * labels, reached through a left join, from gathering one null.
 */
export const labelIdArray =
  sql`json_group_array(${productLabels.labelId} order by ${productLabels.labelId}) filter (where ${productLabels.labelId} is not null)`.mapWith(
    (value: string): string[] => JSON.parse(value) as string[],
  );

const columns = { id: labels.id, name: labels.name };

function labelName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("label.invalid", { field: "name" });
  return name;
}

async function assertNameFree(tx: Transaction, name: string, except: string | null): Promise<void> {
  const [clash] = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.name, name), except === null ? undefined : ne(labels.id, except)));
  if (clash) throw new AppError("label.duplicate", { name });
}

/** Every label, ordered by name then id, with how many products carry each. */
export async function listLabels(tx: Transaction): Promise<LabelSummary[]> {
  return tx
    .select({ ...columns, productCount: count(productLabels.productId) })
    .from(labels)
    .leftJoin(productLabels, eq(productLabels.labelId, labels.id))
    .groupBy(labels.id)
    .orderBy(asc(labels.name), asc(labels.id));
}

export async function createLabel(tx: Transaction, name: string): Promise<Label> {
  const trimmed = labelName(name);
  await assertNameFree(tx, trimmed, null);
  const [created] = await tx.insert(labels).values({ name: trimmed }).returning(columns);
  return created!;
}

export async function renameLabel(tx: Transaction, id: string, name: string): Promise<Label> {
  const trimmed = labelName(name);
  const [current] = await tx.select({ id: labels.id }).from(labels).where(eq(labels.id, id));
  if (!current) throw new AppError("label.not_found", { labelId: id });
  await assertNameFree(tx, trimmed, id);
  const [renamed] = await tx
    .update(labels)
    .set({ name: trimmed, updatedAt: now() })
    .where(eq(labels.id, id))
    .returning(columns);
  return renamed!;
}

/** Deletes the label; `product_labels` cascades, so it leaves every product that carried it. */
export async function deleteLabel(tx: Transaction, id: string): Promise<void> {
  const deleted = await tx.delete(labels).where(eq(labels.id, id)).returning({ id: labels.id });
  if (!deleted.length) throw new AppError("label.not_found", { labelId: id });
}

async function readProductRow(tx: Transaction, productId: string) {
  const [product] = await tx
    .select({ id: products.id, parentId: products.parentId })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new AppError("product.not_found", { productId });
  return product;
}

/** A product's label ids, sorted. A variant's are its parent's. */
export async function readProductLabels(tx: Transaction, productId: string): Promise<string[]> {
  const product = await readProductRow(tx, productId);
  const rows = await tx
    .select({ labelId: productLabels.labelId })
    .from(productLabels)
    .where(eq(productLabels.productId, product.parentId ?? product.id))
    .orderBy(productLabels.labelId);
  return rows.map((row) => row.labelId);
}

/** Replace a product's labels with `labelIds`. A variant has none of its own, so it is refused. */
export async function setProductLabels(
  tx: Transaction,
  productId: string,
  labelIds: string[],
): Promise<void> {
  const product = await readProductRow(tx, productId);
  if (product.parentId !== null)
    throw new AppError("product.variant_invalid", { field: "labelIds" });
  if (!Array.isArray(labelIds) || labelIds.some((id) => typeof id !== "string"))
    throw new AppError("label.invalid", { field: "labelIds" });
  const ids = labelIds.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new AppError("label.invalid", { field: "labelIds" });
  if (ids.length) {
    const found = new Set(
      (await tx.select({ id: labels.id }).from(labels).where(inArray(labels.id, ids))).map(
        (row) => row.id,
      ),
    );
    const missing = ids.findIndex((id) => !found.has(id));
    if (missing !== -1) throw new AppError("label.not_found", { labelId: labelIds[missing]! });
  }
  await tx.delete(productLabels).where(eq(productLabels.productId, product.id));
  if (ids.length)
    await tx
      .insert(productLabels)
      .values(ids.map((labelId) => ({ productId: product.id, labelId })));
}
