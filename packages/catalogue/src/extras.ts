import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError, centsToDecimal, stringToCents } from "@waitron/shared";
import { menuItems } from "./schema/menu.js";
import { reachableMenuItem } from "./menu-structure.js";
import {
  extraListItems,
  extraLists,
  menuItemExtraItems,
  menuItemExtraLists,
  productModifiers,
} from "./schema/extras.js";
import {
  parseExtraListInput,
  parseMenuExtraPublications,
  type ExtraList,
  type ExtraListItem,
  type ExtraListInput,
  type MenuExtraPublication,
} from "./extra-contract.js";
import type { ExtraListDependants } from "./modifier-list-types.js";
import { findContentTranslationGap } from "./content-languages.js";
import { parentsWithActiveVariants } from "./variants.js";
import "./errors.js";

/**
 * What one of this extra costs on a line: the menu offer's price if that offer set one, else the
 * list item's own, else the product's `unitPrice` (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3). Only null and undefined
 * fall through — `"0.00"` is a price a venue chose. `undefined` back means nothing can price it.
 */
export function resolveExtraPrice(
  item: ExtraListItem,
  product: { unitPrice: string } | undefined,
  menuPrice?: string | null,
): string | undefined {
  return menuPrice ?? item.price ?? product?.unitPrice;
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
    const { listId, price, ...item } = row;
    const held = grouped.get(listId) ?? [];
    // A null price means "inherit" and a stored zero means "free": `resolveExtraPrice` reads the
    // two differently, so the conversion must keep them apart.
    held.push({ ...item, price: price === null ? null : centsToDecimal(price) });
    grouped.set(listId, held);
  }
  return lists.map((list) => ({ ...list, items: grouped.get(list.id) ?? [] }));
}

export async function listExtraLists(tx: Transaction): Promise<ExtraList[]> {
  const lists = await tx
    .select(listColumns)
    .from(extraLists)
    .orderBy(extraLists.sort, extraLists.id);
  return withItems(tx, lists);
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
 * Replacing the set is safe because nothing holds a key into `extra_list_items`:
 * ``grep -rn 'REFERENCES `extra_list_items' --include='*.sql' packages`` finds nothing, a menu
 * override names the PRODUCT and is cleaned up by {@link dropStaleMenuOverrides}, and an order's
 * child line names the picked product (`buildLineExtras`, `apps/server/src/modifier-selection.ts`).
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
        .select({ id: extraListItems.id, listId: extraListItems.listId })
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
        sort,
      })
      .onConflictDoNothing({ target: extraListItems.id })
      .returning({ id: extraListItems.id });
    if (!inserted.length) throw new AppError("extras.invalid", { field: `items.${sort}.id` });
  }
}

/**
 * Remove the per-menu overrides of products this list no longer offers. Nothing in the database does
 * it: `menu_item_extra_items` carries no foreign key into `extra_list_items` (schema/extras.ts).
 * Without this, dropping a product from a list and adding it back would resurrect an old override.
 * `notInArray` with an EMPTY array matches every row, so an emptied list loses all its overrides.
 */
async function dropStaleMenuOverrides(
  tx: Transaction,
  extraListId: string,
  input: ExtraListInput,
): Promise<void> {
  await tx.delete(menuItemExtraItems).where(
    and(
      eq(menuItemExtraItems.listId, extraListId),
      notInArray(
        menuItemExtraItems.productId,
        input.items.map((item) => item.productId),
      ),
    ),
  );
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
  // Only here, and not in {@link createExtraList}: that path mints the list id a statement earlier,
  // so no menu offer can hold an override against it yet.
  await dropStaleMenuOverrides(tx, extraListId, input);
  return getExtraList(tx, extraListId);
}

export async function deleteExtraList(tx: Transaction, extraListId: string): Promise<void> {
  await assertExtraListForWrite(tx, extraListId);
  // The list's items, its menu publications and their per-item overrides all go with it by ON DELETE
  // CASCADE. No open-order check: an order's child line names the picked PRODUCT, not the list.
  await tx.delete(extraLists).where(eq(extraLists.id, extraListId));
}

/**
 * Every published list exists. In id order, so `extras.not_found` names the lowest unknown id; no
 * test pins which.
 */
async function assertPublishedListsExist(
  tx: Transaction,
  publications: MenuExtraPublication[],
): Promise<void> {
  // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
  for (const listId of publications.map((publication) => publication.listId).sort())
    await assertExtraListForWrite(tx, listId);
}

/**
 * Every list the body publishes is one the dish's PRODUCT carries in `product_modifiers`, refused as
 * `extras.invalid` naming the publication's position. The database refuses nothing here:
 * `menu_item_extra_lists` has no key into `product_modifiers`. Nothing refuses an offer that
 * publishes none of its product's lists; whether anything should is open. ONE grouped query.
 */
async function assertProductCarries(
  tx: Transaction,
  productId: string,
  publications: MenuExtraPublication[],
): Promise<void> {
  if (publications.length === 0) return;
  const rows = await tx
    .select({ extraListId: productModifiers.extraListId })
    .from(productModifiers)
    .where(
      and(
        eq(productModifiers.productId, productId),
        inArray(
          productModifiers.extraListId,
          publications.map((publication) => publication.listId),
        ),
      ),
    );
  const held = new Set(rows.map((row) => row.extraListId));
  const at = publications.findIndex((publication) => !held.has(publication.listId));
  if (at !== -1) throw new AppError("extras.invalid", { field: `lists.${at}.listId` });
}

/** A list-and-product pair as one key, joined by a byte no uuid can contain. */
const offeredKey = (listId: string, productId: string) => `${listId}\u0000${productId}`;

/**
 * Every overridden product is one its list offers, refused as `extras.invalid` with the item's
 * position. The database would accept it: a menu row carries no key into `extra_list_items`
 * (schema/extras.ts). ONE grouped query.
 */
async function assertProductsOffered(
  tx: Transaction,
  publications: MenuExtraPublication[],
): Promise<void> {
  const overriding = publications.filter((publication) => publication.items.length > 0);
  if (overriding.length === 0) return;
  const rows = await tx
    .select({ listId: extraListItems.listId, productId: extraListItems.productId })
    .from(extraListItems)
    .where(
      inArray(
        extraListItems.listId,
        overriding.map((publication) => publication.listId),
      ),
    );
  const offered = new Set(rows.map((row) => offeredKey(row.listId, row.productId)));
  for (const publication of overriding) {
    const stray = publication.items.find(
      (item) => !offered.has(offeredKey(publication.listId, item.productId)),
    );
    if (stray) throw new AppError("extras.invalid", { field: `${stray.field}.productId` });
  }
}

/**
 * Replace what one menu offer publishes: which extras lists it carries, in which order
 * (`display_order` is the position in `lists`), and how it narrows and reprices each one (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.2).
 *
 * **An item row is an OVERRIDE, not a publication.** A list item with no row here is offered on this
 * menu at its own resolved price; a row replaces that price when it carries one, and withdraws the
 * item when `available` is false.
 */
export async function setMenuItemExtraLists(
  tx: Transaction,
  menuItemId: string,
  lists: unknown,
): Promise<void> {
  const offerId = menuItemId.toLowerCase();
  const offer = await reachableMenuItem(tx, offerId);
  if (offer === undefined) throw new AppError("menu_item.not_found", { menuItemId });
  const publications = parseMenuExtraPublications(lists);
  await assertPublishedListsExist(tx, publications);
  // Carrying the list comes first: a body that publishes a list the dish does not have is wrong
  // about the list, whatever its overrides then say.
  await assertProductCarries(tx, offer.productId, publications);
  await assertProductsOffered(tx, publications);

  // The offer's item rows cascade with its list rows, so this one delete clears both tables for this
  // offer and no row the body keeps can collide with a row it is replacing.
  await tx.delete(menuItemExtraLists).where(eq(menuItemExtraLists.menuItemId, offerId));
  if (publications.length === 0) return;
  await tx.insert(menuItemExtraLists).values(
    publications.map((publication, displayOrder) => ({
      menuItemId: offerId,
      listId: publication.listId,
      displayOrder,
    })),
  );
  const items = publications.flatMap((publication) =>
    publication.items.map((item) => ({
      menuItemId: offerId,
      listId: publication.listId,
      productId: item.productId,
      price: item.price === null ? null : stringToCents(item.price),
      available: item.available,
    })),
  );
  if (items.length > 0) await tx.insert(menuItemExtraItems).values(items);
}

// The shape lives in `modifier-list-types.ts`, the browser-safe leaf the dashboard imports.
export type { ExtraListDependants } from "./modifier-list-types.js";

/**
 * What deleting this list would touch — the preview a delete confirmation reads: the products that
 * carry it and the menu offers that publish it, each detached by the delete rather than blocking it.
 * No order is consulted: an order's child line names the PRODUCT, not the list. A menu publication
 * has no name of its own, so it is identified by the menu item's id and its product's staff name.
 */
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
  const menus = await tx
    .select({ id: menuItems.id, name: products.name })
    .from(menuItemExtraLists)
    .innerJoin(menuItems, eq(menuItems.id, menuItemExtraLists.menuItemId))
    .innerJoin(products, eq(products.id, menuItems.productId))
    .where(eq(menuItemExtraLists.listId, extraListId))
    .orderBy(menuItems.id);
  return { products: carrying, menus };
}
