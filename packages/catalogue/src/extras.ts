import { randomUUID } from "node:crypto";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToThousandths,
  stringToCents,
  thousandthsToDecimal,
  toScale,
} from "@waitron/shared";
import { extraListItems, extraLists, productModifiers } from "./schema/extras.js";
import {
  parseExtraListInput,
  type ExtraList,
  type ExtraListItem,
  type ExtraListInput,
} from "./extra-contract.js";
import type { ExtraListDependants, ExtraListRow } from "./modifier-list-types.js";
import { findContentTranslationGap } from "./content-languages.js";
import { parentsWithActiveVariants } from "./variants.js";
import { productUnits, units } from "./schema/units.js";
import { parentJoin, parentProducts, unitOwnerJoin } from "./variant-fallback.js";
import { assertQuantityPrecision } from "./unit-validation.js";
import { priceForExtraPortion } from "./extra-contract.js";
import "./errors.js";

export function resolveExtraPrice(
  item: ExtraListItem,
  product: { unitPrice: string } | undefined,
): string | undefined {
  return priceForExtraPortion(item, product?.unitPrice);
}

// A list's `sort` is never written from a body (`parseExtraListInput` accepts no such key), so every
// list keeps the column default and the id decides the order.
const listColumns = {
  id: extraLists.id,
  name: extraLists.name,
  customerName: extraLists.customerName,
  kitchenName: extraLists.kitchenName,
  minPicks: extraLists.minPicks,
  maxPicks: extraLists.maxPicks,
  active: extraLists.active,
};
// An item has no name of its own: its names come from the product it names.
const itemColumns = {
  id: extraListItems.id,
  productId: extraListItems.productId,
  maxQuantity: extraListItems.maxQuantity,
  preselected: extraListItems.preselected,
  price: extraListItems.price,
  portion: extraListItems.portion,
};

/** One query for every list's items, never one per list, whatever the number of lists. */
async function withItems(tx: Transaction, lists: Omit<ExtraList, "items">[]): Promise<ExtraList[]> {
  if (lists.length === 0) return [];
  const rows = await tx
    .select({ listId: extraListItems.listId, ...itemColumns })
    .from(extraListItems)
    .where(
      inArray(
        extraListItems.listId,
        lists.map((list) => list.id),
      ),
    )
    .orderBy(extraListItems.sort, extraListItems.id);
  const grouped = new Map<string, ExtraListItem[]>();
  for (const row of rows) {
    const { listId, price, portion, ...item } = row;
    const held = grouped.get(listId) ?? [];
    // A null price means "inherit" and a stored zero means "free": `resolveExtraPrice` reads the
    // two differently, so the conversion must keep them apart.
    held.push({
      ...item,
      price: price === null ? null : centsToDecimal(price),
      portion: toScale(thousandthsToDecimal(portion), 3),
    });
    grouped.set(listId, held);
  }
  return lists.map((list) => ({ ...list, items: grouped.get(list.id) ?? [] }));
}

export type { ExtraListRow } from "./modifier-list-types.js";

/** Every list with its items and its usage: one grouped count per carrying table, never one per list. */
export async function listExtraLists(tx: Transaction): Promise<ExtraListRow[]> {
  const lists = await tx
    .select(listColumns)
    .from(extraLists)
    .orderBy(extraLists.sort, extraLists.id);
  const withAll = await withItems(tx, lists);
  const productCounts = await tx
    .select({
      listId: productModifiers.extraListId,
      count: sql<number>`count(distinct ${productModifiers.productId})`,
    })
    .from(productModifiers)
    .where(isNotNull(productModifiers.extraListId))
    .groupBy(productModifiers.extraListId);
  const byProducts = new Map(productCounts.map((row) => [row.listId, row.count]));
  return withAll.map((list) => ({
    ...list,
    usage: { products: byProducts.get(list.id) ?? 0 },
  }));
}

/** The named lists, in the order {@link listExtraLists} returns them, each with its items. */
export async function readExtraListsByIds(
  tx: Transaction,
  extraListIds: string[],
): Promise<ExtraList[]> {
  if (extraListIds.length === 0) return [];
  const lists = await tx
    .select(listColumns)
    .from(extraLists)
    .where(inArray(extraLists.id, extraListIds))
    .orderBy(extraLists.sort, extraLists.id);
  return withItems(tx, lists);
}

export async function getExtraList(tx: Transaction, extraListId: string): Promise<ExtraList> {
  const [list] = await readExtraListsByIds(tx, [extraListId]);
  if (!list) throw new AppError("extras.not_found", { extraListId });
  return list;
}

/** The list exists — the preview path's half of the pair below. */
async function assertExtraList(tx: Transaction, extraListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: extraLists.id })
    .from(extraLists)
    .where(eq(extraLists.id, extraListId));
  if (!list) throw new AppError("extras.not_found", { extraListId });
}

/**
 * The list exists. The write paths' half of the pair above, kept apart so a caller says which one it
 * is making.
 *
 * ## Why this stopped being a lock — the pattern for every `select … for update` in this package
 *
 * `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside the venue file's write
 * queue, which admits ONE write transaction on the file at a time, so a read a write path takes is
 * still true when its later statements run. Receipt: `racePair` in
 * `packages/catalogue/test/fixtures.ts`, and docs/developers/conventions-data.md.
 */
async function assertExtraListForWrite(tx: Transaction, extraListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: extraLists.id })
    .from(extraLists)
    .where(eq(extraLists.id, extraListId));
  if (!list) throw new AppError("extras.not_found", { extraListId });
}

/**
 * Only the optional customer-facing name map needs text in the venue's default content language; a
 * null one is legal because it falls back to `name`. The refusal carries the field path so an editor
 * can put it beside the input.
 */
async function validateNames(
  tx: Transaction,
  input: ExtraListInput,
  fallbackLanguage: string,
): Promise<void> {
  if (input.customerName === null) return;
  const gap = await findContentTranslationGap(tx, [input.customerName], fallbackLanguage);
  if (gap !== null)
    throw new AppError("extras.translation_required", {
      field: "customerName",
      language: gap.language,
    });
}

// Everything on the body EXCEPT the items, which live in their own table. Taken as "the rest" rather
// than field by field, so a column added to `ExtraListInput` later cannot be left unwritten.
function listValues(input: ExtraListInput) {
  const { items, ...values } = input;
  void items; // discarded on purpose; the lint rule does not exempt a rest sibling
  return values;
}

/**
 * Refuses an item naming a product no `products` row holds, as `extras.invalid` carrying that item's
 * position, so an editor can put the message beside the input; the foreign key under it names no
 * field. ONE grouped read for the whole body. Both sides of the comparison are lower-case ids.
 */
async function assertProductsExist(tx: Transaction, input: ExtraListInput): Promise<void> {
  const named = [...new Set(input.items.map((item) => item.productId))];
  if (named.length === 0) return;
  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, named));
  const held = new Set(rows.map((row) => row.id));
  const at = input.items.findIndex((item) => !held.has(item.productId));
  if (at !== -1) throw new AppError("extras.invalid", { field: `items.${at}.productId` });
}

type SavedItem = { productId: string; portion: number };

/** `savedById` holds this list's saved rows for the ids the body sends. */
async function assertPortionPrecision(
  tx: Transaction,
  savedById: ReadonlyMap<string, SavedItem>,
  input: ExtraListInput,
): Promise<void> {
  const savedFor = (item: ExtraListInput["items"][number]) =>
    item.id === undefined ? undefined : savedById.get(item.id);
  // New means the list holds no row for the item's product under its id, not that no id was sent:
  // the dashboard's editor sends one for every row it adds.
  const isNew = (item: ExtraListInput["items"][number]) =>
    savedFor(item)?.productId !== item.productId;
  const named = input.items.filter((item) => item.portion !== undefined || isNew(item));
  if (named.length === 0) return;
  const rows = await tx
    .select({
      id: products.id,
      unitId: units.id,
      precision: units.precision,
      seedKey: units.seedKey,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(
      inArray(
        products.id,
        named.map((item) => item.productId),
      ),
    );
  const unitByProduct = new Map(rows.map((row) => [row.id, row]));
  for (const [index, item] of input.items.entries()) {
    const unit = unitByProduct.get(item.productId);
    const precision = unit?.precision ?? 0;
    const each = unit?.unitId === null || unit?.seedKey === "each";
    const saved = savedFor(item);
    if (item.portion === undefined) {
      if (isNew(item) && !each)
        throw new AppError("extras.invalid", { field: `items.${index}.portion` });
      continue;
    }
    if (
      saved?.productId === item.productId &&
      saved.portion === decimalToThousandths(decimal(item.portion))
    )
      continue;
    try {
      if (each && item.portion !== "1.000") throw new Error("Each portion must be one");
      assertQuantityPrecision(item.portion, precision, {
        positive: true,
      });
    } catch {
      throw new AppError("extras.invalid", { field: `items.${index}.portion` });
    }
  }
}

/** The till never offers a product with an Active variant as an extra, so a list may not name one. */
async function assertNoParentsWithVariants(tx: Transaction, input: ExtraListInput): Promise<void> {
  const parents = await parentsWithActiveVariants(
    tx,
    input.items.map((item) => item.productId),
  );
  const at = input.items.findIndex((item) => parents.has(item.productId));
  if (at !== -1)
    throw new AppError("extras.product_has_variants", {
      field: `items.${at}.productId`,
      productId: input.items[at]!.productId,
    });
}

/**
 * Replaces the list's items with the body's, in the body's order: EVERY item of the list is deleted
 * and the body's inserted fresh, each under the id the body sent or a new one. Editing retained rows
 * in place could break `extra_list_items_list_product_uq` midway through a legal body that exchanges
 * two items' products. "saves a body that exchanges two retained items' products"
 * (extras.concurrency.test.ts) passes on this engine; that it fails without the delete-then-insert
 * has not been re-checked since the storage switch. Receipt: docs/developers/conventions-data.md.
 *
 * An id that names an item of a DIFFERENT list is refused as `extras.invalid` rather than moving it.
 */
async function writeItems(
  tx: Transaction,
  extraListId: string,
  input: ExtraListInput,
): Promise<void> {
  await assertProductsExist(tx, input);
  await assertNoParentsWithVariants(tx, input);
  const bodyIds = input.items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
  const existing = bodyIds.length
    ? await tx
        .select({
          id: extraListItems.id,
          listId: extraListItems.listId,
          productId: extraListItems.productId,
          portion: extraListItems.portion,
        })
        .from(extraListItems)
        .where(inArray(extraListItems.id, bodyIds))
    : [];
  const foreign = new Set(
    existing.filter((row) => row.listId !== extraListId).map((row) => row.id),
  );
  if (foreign.size) {
    const at = input.items.findIndex((item) => item.id !== undefined && foreign.has(item.id));
    throw new AppError("extras.invalid", { field: `items.${at}.id` });
  }
  // After the foreign-id refusal, so every row handed to the portion check is this list's.
  await assertPortionPrecision(tx, new Map(existing.map((row) => [row.id, row])), input);
  // The list now starts from nothing, so no row the body keeps can collide with a row it replaces.
  await tx.delete(extraListItems).where(eq(extraListItems.listId, extraListId));
  for (const [sort, item] of input.items.entries()) {
    // The conflict clause names the PRIMARY KEY: left untargeted it would also absorb an
    // `extra_list_items_list_product_uq` collision and report a product clash as a stolen id.
    const inserted = await tx
      .insert(extraListItems)
      .values({
        id: item.id ?? randomUUID(),
        listId: extraListId,
        productId: item.productId,
        maxQuantity: item.maxQuantity,
        preselected: item.preselected,
        price: item.price === null ? null : stringToCents(item.price),
        portion: decimalToThousandths(decimal(item.portion ?? "1")),
        sort,
      })
      .onConflictDoNothing({ target: extraListItems.id })
      .returning({ id: extraListItems.id });
    if (!inserted.length) throw new AppError("extras.invalid", { field: `items.${sort}.id` });
  }
}

/** The only write path here that reads no EXISTING list row, because the id is minted below. */
export async function createExtraList(
  tx: Transaction,
  value: unknown,
  fallbackLanguage: string,
): Promise<ExtraList> {
  const input = parseExtraListInput(value);
  await validateNames(tx, input, fallbackLanguage);
  const extraListId = randomUUID();
  await tx.insert(extraLists).values({ id: extraListId, ...listValues(input) });
  await writeItems(tx, extraListId, input);
  return getExtraList(tx, extraListId);
}

export async function updateExtraList(
  tx: Transaction,
  callerListId: string,
  value: unknown,
  fallbackLanguage: string,
): Promise<ExtraList> {
  const input = parseExtraListInput(value);
  // The caller's id does not come through the contract, so it is lower-cased here: `writeItems`
  // compares it in JavaScript against a stored `list_id`.
  const extraListId = callerListId.toLowerCase();
  // The list has to exist before its name is worth checking, or updating an id that names nothing
  // reports a translation problem for a list that is not there.
  await assertExtraListForWrite(tx, extraListId);
  await validateNames(tx, input, fallbackLanguage);
  await tx.update(extraLists).set(listValues(input)).where(eq(extraLists.id, extraListId));
  await writeItems(tx, extraListId, input);
  return getExtraList(tx, extraListId);
}

export async function deleteExtraList(tx: Transaction, extraListId: string): Promise<void> {
  await assertExtraListForWrite(tx, extraListId);
  await tx.delete(extraLists).where(eq(extraLists.id, extraListId));
}

// The shape lives in `modifier-list-types.ts`, the browser-safe leaf the dashboard imports.
export type { ExtraListDependants } from "./modifier-list-types.js";

export async function extraListDependants(
  tx: Transaction,
  extraListId: string,
): Promise<ExtraListDependants> {
  await assertExtraList(tx, extraListId);
  // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
  const carrying = await tx
    .select({ id: products.id, name: products.name })
    .from(productModifiers)
    .innerJoin(products, eq(products.id, productModifiers.productId))
    .where(eq(productModifiers.extraListId, extraListId))
    .orderBy(products.name, products.id);
  return { products: carrying };
}
