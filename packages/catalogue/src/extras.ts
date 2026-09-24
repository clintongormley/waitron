import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError, centsToDecimal, stringToCents } from "@waitron/shared";
import { menuItems } from "./schema/menu.js";
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
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3).
 *
 * Only null and undefined fall through — `"0.00"` is a price a venue chose and is kept, which is
 * what makes a free bread expressible. VAT does not resolve this way at all: an extra always carries
 * its product's rate — the product's own, or its parent's where a variant leaves it blank — never
 * the dish's.
 *
 * `undefined` back means the chain ran out: no menu price, no price on the item, and no product row
 * to borrow one from. The caller decides what that means — `readMenuExtras` (extra-projection.ts)
 * leaves such an item out of the menu view, because an item nothing can price cannot be sold.
 */
export function resolveExtraPrice(
  item: ExtraListItem,
  product: { unitPrice: string } | undefined,
  menuPrice?: string | null,
): string | undefined {
  return menuPrice ?? item.price ?? product?.unitPrice;
}

// A LIST's `sort` is read but never written from a body: it is not one of the keys
// `parseExtraListInput` accepts, so every list saved here keeps the column default and the id
// decides the order. An ITEM's `sort` is different — `writeItems` writes it from the item's position
// in the body.
const listColumns = {
  id: extraLists.id,
  name: extraLists.name,
  customerName: extraLists.customerName,
  kitchenName: extraLists.kitchenName,
  minPicks: extraLists.minPicks,
  maxPicks: extraLists.maxPicks,
  active: extraLists.active,
};
// No name of any kind: an item's three names, VAT class, allergens, dietary labels and photo all
// come from the product it names (spec §3.1).
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

/**
 * The named lists, in the order {@link listExtraLists} returns them, each with its items. Two
 * queries whatever the number of ids — the menu projection (extra-projection.ts) wants exactly the
 * lists one menu publishes rather than the whole catalogue's.
 */
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
 * The list exists. The write paths' half of the pair above — the same read, kept apart so a caller
 * says which one it is making.
 *
 * ## Why this stopped being a lock — the pattern for every `select … for update` in this package
 *
 * On PostgreSQL this took `for update` on the list's row, and what that arranged was: two saves of
 * the SAME list run one after the other instead of overlapping. {@link writeItems} needed it,
 * because it replaces the whole item set, and a `delete` cannot see another transaction's
 * uncommitted inserts — so an unserialised second save removed nothing and then collided on
 * `extra_list_items_list_product_uq`.
 *
 * There is no second save to overlap with. `withTransaction` (`packages/db/src/tenancy.ts`) runs
 * its body inside the venue file's write queue, and that queue admits ONE write transaction on the
 * file at a time: `packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body,
 * then `commit`, and the next caller's `begin` does not run until that `commit` has returned. So a
 * read a write path takes is still true when its later statements run — for every row in the file,
 * not only for the one a clause named. SQLite has no row locks to take instead, and drizzle's
 * SQLite query builder has no `.for()` at all.
 *
 * The receipt is `racePair` in `packages/catalogue/test/fixtures.ts`: it holds one transaction open
 * and asserts the second has not run a statement of its own. Run with the second body started
 * outside `withTransaction`, that assertion reads `expected true to be false` — the control is
 * recorded on the function itself, and every concurrency case in this package goes through it.
 *
 * What this function still does is the 404, which it always also did.
 */
async function assertExtraListForWrite(tx: Transaction, extraListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: extraLists.id })
    .from(extraLists)
    .where(eq(extraLists.id, extraListId));
  if (!list) throw new AppError("extras.not_found", { extraListId });
}

/**
 * The staff `name` and `kitchenName` are plain text and need no translation check; the optional
 * customer-facing MAP is what must have text in the venue's default content language, and a null one is legal
 * because it falls back to `name` — the rule `setProductVariants` follows (variants.ts).
 *
 * An extras list holds exactly ONE such map, where an options list holds one per label as well as
 * its own: an item names a product and carries no name of its own (extra-contract.ts's
 * `ExtraListItem`), so the field path this reports is always `"customerName"`. A GAP is not thrown
 * by `findContentTranslationGap` — it RETURNS which map has one — and the throw below attaches the
 * field path, so an editor can put the refusal beside the input. It does throw on a key that is not
 * a language code or a value that is not text (content-languages.ts), with no field on the error —
 * but `parseExtraListInput` has refused both before a body gets this far.
 */
async function validateNames(
  tx: Transaction,
  input: ExtraListInput,
  fallbackLanguage: string,
): Promise<void> {
  // A list carrying no customer-facing name has nothing to check and so touches the database not at
  // all — no lock, no read.
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
 * position in the body, so an editor can put the message beside the input it came from. Without this
 * the id reaches `extra_list_items_product_fk` and surfaces as a `23503` driver error carrying no
 * field at all.
 *
 * The foreign key STAYS: it is the database backstop under this refusal, for a write that never
 * comes through here — the same division `parseExtraListInput` and
 * `extra_list_items_list_product_uq` already make for the one-offer-per-product rule.
 *
 * ONE grouped read for the whole body, never one per item (CLAUDE.md §3). The set comparison is a
 * plain string match because both sides are already lower-cased — see the contract's `id`
 * (extra-contract.ts) for why that holds.
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
 * Replaces the list's items with the body's, in the body's order. An item the body omits is removed:
 * no foreign key anywhere references `extra_list_items` (re-taken 2026-09-22:
 * `grep -rn extra_list_items --include='*.sql' packages apps | grep -i references` finds nothing).
 * The command had to be re-taken, not just re-run: the reading recorded here searched for
 * `REFERENCES "public"."extra_list_items"`, and this engine's generated SQL carries no `"public".`
 * qualification at all, so that spelling now finds nothing whether or not such a key exists —
 * `grep -rln 'REFERENCES "public"' --include='*.sql' packages apps` is empty, which is the control,
 * the one thing that tracks an item by its PRODUCT instead is cleaned up separately
 * ({@link dropStaleMenuOverrides}), and
 * the design has an open order's child line point at the PRODUCT rather than back at the item
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4), which is what the order
 * path does: `buildLineExtras` (`apps/server/src/modifier-selection.ts`), reached from
 * `priceOrderLines` and `updateHeldOrder` (`apps/server/src/working-order.ts`), writes a child line
 * carrying the picked product and its three frozen names, and `working_order_lines` carries no
 * column naming a list or an item at all — so there is still nothing on the order side to check.
 *
 * EVERY item of the list is deleted and the body's are inserted fresh, each under the id the body
 * sent or a new one, so an item keeps its identity only because the body carries that id. Editing
 * the retained rows in place instead left an intermediate state a legal body could break:
 * `extra_list_items_list_product_uq` covers `(list_id, product_id)`, so a body exchanging two
 * retained items' products failed on the first update with `23505 duplicate key value` although its
 * final product set was fine. Seen red that way by "saves a body that exchanges two retained items'
 * products" (extras.concurrency.test.ts), which still runs. That reading was taken on PostgreSQL,
 * where the refusal was `23505`; it has NOT been re-taken since the storage switch, so what is known
 * today is that the case passes on this engine, not that deleting the delete-then-insert would still
 * turn it red.
 *
 * An id that names an item of a DIFFERENT list is refused as `extras.invalid` rather than moving
 * that item, and that refusal is decided on a plain `select` before any insert below. Two saves
 * that each name the other list's item both read, both see the other's item still there, and both
 * refuse. Left to the insert's primary-key conflict instead, each save waited on the other's
 * uncommitted delete and PostgreSQL ended one of them with `40P01 deadlock detected` in place of a
 * domain refusal — measured that way on PostgreSQL with the check removed, five runs out of five.
 * That deadlock is not a shape one writer can produce, so the reason for the check is now the
 * domain refusal alone. The case meant to hold it is the final assertion of "refuses both of two
 * saves that each claim the other list's item" (extras.concurrency.test.ts), which reads both lists
 * back unchanged; that it fails without the check is inherited from the PostgreSQL reading and has
 * not been re-taken on this engine.
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
  // Within this transaction the list now starts from nothing, so no row the body keeps can collide
  // with a row it is replacing. There are no rows another transaction is writing either: one write
  // transaction runs on the venue file at a time ({@link assertExtraListForWrite}).
  await tx.delete(extraListItems).where(eq(extraListItems.listId, extraListId));
  for (const [sort, item] of input.items.entries()) {
    // Each item's `sort` is its position in the body, so the order the editor sent is the order
    // `listExtraLists` and `getExtraList` read back.
    // An id another save has already COMMITTED is refused as a domain fault rather than surfacing
    // as a driver error. The conflict clause names the PRIMARY KEY: left untargeted, drizzle emits
    // a bare `on conflict do nothing`, which also absorbs an `extra_list_items_list_product_uq`
    // collision and would report a product clash as a stolen id. The two-writer hedges this note
    // used to carry are gone with the writers: one write transaction runs on the venue file at a
    // time ({@link assertExtraListForWrite}), so no uncommitted insert of another save exists for this one to
    // miss or to wait on.
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
 * it: a menu offer's override row (`menu_item_extra_items`) names its product directly and
 * deliberately carries no foreign key into `extra_list_items`, for the reason stated where that
 * table is declared (schema/extras.ts). Without this statement, dropping a product from a list and
 * adding it back again would resurrect a price the manager last set against an offer that no longer
 * exists.
 *
 * `notInArray` with an EMPTY array is `sql`true``, not a statement that matches nothing
 * (drizzle-orm 0.45.2, sql/expressions/conditions.js:82-88), so an emptied list correctly loses all
 * of its overrides rather than keeping them. Both cases are covered by
 * "a menu override whose product leaves the list" (extra-projection.test.ts).
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
  // The caller's own id does not come through the contract, so it is normalised here and used from
  // here on: `writeItems` compares it in JavaScript against a stored `list_id`, so an upper-cased id
  // finds the list in SQL and then matches none of the list's own items — the regression is pinned by
  // "treats a list's own items as its own when the list id arrives in upper case" (extras.test.ts).
  // Why lower case is the comparable form is stated on the contract's `id` (extra-contract.ts).
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
  // Three sets of rows go with it, all by ON DELETE CASCADE: the list's items through
  // `extra_list_items_list_fk`, every menu offer's publication of it through
  // `menu_item_extra_lists_list_fk` and, under those, each offer's per-item overrides through
  // `menu_item_extra_items_list_fk` — all three declared in drizzle/0000_catalogue_baseline.sql. Run
  // rather than read off the clauses, by "takes the publication and its overrides with it when the
  // list is deleted" (extra-projection.test.ts). There is no open-order check, because the design
  // has an open order's child line carry the product rather than the list (spec §3.5, §3.4), and
  // that is what the order path writes today (`buildLineExtras`,
  // `apps/server/src/modifier-selection.ts`): a child line names the picked PRODUCT and freezes its
  // names, so deleting the list that offered it reaches no open order.
  await tx.delete(extraLists).where(eq(extraLists.id, extraListId));
}

/**
 * Every published list exists.
 *
 * This used to hold each of their rows `for update` until the transaction ended, so that a save of
 * one of those lists could not land between {@link assertProductsOffered}'s membership read and the
 * override rows written below. There is no such window left: one write transaction runs on the
 * venue file at a time ({@link assertExtraListForWrite} carries the mechanism and the receipt), so no save of
 * any list can land between any two statements of this one.
 *
 * With the locks gone, so is the lock ORDER the rest of this note used to reason about, and so is
 * the deadlock the ascending sort was measured against. The sort STAYS, for the one effect it has
 * left: an unknown list id is refused from inside this loop as `extras.not_found`, so the id the
 * refusal names is the lowest unknown one in string order rather than the first unknown one in body
 * order. No test pins which — the sort is kept because removing it would change an unpinned refusal
 * for no reason, not because anything rests on it.
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
 * Every list the body publishes is one the dish's PRODUCT carries in `product_modifiers`; a list it
 * does not carry is refused. There is NO check the other way round: nothing refuses an offer that
 * publishes none of the lists its product carries. Whether there should be is open, not decided
 * here — an extras list has no `required` flag to read (the spec makes "required" `min_picks >= 1`,
 * §3.1), and §3.2 says only which lists an offer publishes, never that any of them must be there.
 *
 * A menu offer narrows and reprices what the product already offers (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.2), so publishing a list the
 * product does not carry would put items on a dish that does not have them. Refused as
 * `extras.invalid` naming the publication's own position, the path `parseMenuExtraPublications`
 * (extra-contract.ts) builds for its own refusals, so an editor can put the message beside the
 * input. The database refuses nothing here: `menu_item_extra_lists` has a key into `extra_lists`
 * and none into `product_modifiers`.
 *
 * ONE grouped query for the whole body, never one per list (CLAUDE.md §3).
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
 * Every overridden product is one its list actually offers. Refused here as `extras.invalid` with
 * the item's own position, so an editor can put the message beside the input; left to the database
 * there is nothing to refuse it at all, because a menu row carries no key into `extra_list_items`
 * (schema/extras.ts) — it would simply be ignored by the menu view for ever.
 *
 * ONE grouped query for the whole body, never one per list (CLAUDE.md §3).
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
 * Replace what one menu offer publishes: which extras lists it carries, in which order, and how it
 * narrows and reprices each one (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.2). `display_order` is the
 * position in `lists`, so the order the editor sent is the order the menu reads back.
 *
 * **An item row is an OVERRIDE, not a publication.** A list item with no row here is offered on this
 * menu at its own resolved price; a row replaces that price when it carries one, and withdraws the
 * item when `available` is false. Row presence does not have to carry narrowing, because the row
 * has an explicit `available` flag for it; and §3.2 says a menu offer MAY narrow and reprice, so an
 * offer that narrows nothing offers the whole list.
 *
 * **A list the dish's product does not carry is refused** ({@link assertProductCarries}). Nothing
 * refuses an offer that publishes none of the product's lists, for the reason
 * {@link assertProductCarries} gives.
 *
 * Two saves of the SAME offer run one after the other rather than overlapping, which is what the
 * offer's `for update` used to arrange and what the venue file's write queue arranges now
 * ({@link assertExtraListForWrite}). The published lists are checked next, in id order, for the reason
 * {@link assertPublishedListsExist} gives.
 */
export async function setMenuItemExtraLists(
  tx: Transaction,
  menuItemId: string,
  lists: unknown,
): Promise<void> {
  const offerId = menuItemId.toLowerCase();
  const [offer] = await tx
    .select({ id: menuItems.id, productId: menuItems.productId })
    .from(menuItems)
    .where(eq(menuItems.id, offerId));
  if (offer === undefined) throw new AppError("menu_item.not_found", { menuItemId });
  const publications = parseMenuExtraPublications(lists);
  await assertPublishedListsExist(tx, publications);
  // Nothing can change `product_modifiers`, or any other table, between these two reads and the
  // commit below: one write transaction runs on the venue file at a time ({@link assertExtraListForWrite}).
  // The whole paragraph this note used to carry — which lock conflicted with which, in what order
  // the two paths took `extra_lists` rows, and why the wait was not a deadlock — was about two
  // transactions that can no longer overlap.
  // Carrying the list comes first: a body that publishes a list the dish does not have is wrong
  // about the list, whatever its overrides then say.
  await assertProductCarries(tx, offer.productId, publications);
  await assertProductsOffered(tx, publications);

  // The offer's item rows go with its list rows, through `menu_item_extra_items_list_fk`
  // (drizzle/0000_catalogue_baseline.sql), so this one delete clears both tables for this
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

// The shape lives in `modifier-list-types.ts`, the browser-safe LEAF the dashboard imports; this
// file keeps the code that builds it and re-exports the type so existing imports are unchanged.
export type { ExtraListDependants } from "./modifier-list-types.js";

/**
 * What deleting this list would touch — the preview a delete confirmation reads. Both sides are
 * detached by the delete rather than blocking it, and no order is consulted: an open order's child
 * line points at the PRODUCT, not at the list
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.5, §3.4).
 *
 * The two sides are not the same kind of thing. A MENU publishes the list in its own right, through
 * `menu_item_extra_lists` (§3.2) — unlike an options list, which has no per-menu row at all. A
 * publication has no name of its own, so it is identified by the menu ITEM's id and the staff name
 * of the product that dish is.
 *
 * A PRODUCT carries the list in its own right too, through `product_modifiers` (spec §5). The two
 * sides are two separate reads rather than one reached through the other, because neither follows
 * from the other: a dish can carry the list and be on no menu at all.
 *
 * The products come back alphabetical by staff name with the id breaking a tie, so a confirmation
 * dialog reads in a fixed order whichever ids were minted; the menus stay in offer-id order. An
 * INACTIVE menu offer is listed like any other — deleting the list detaches it either way.
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
