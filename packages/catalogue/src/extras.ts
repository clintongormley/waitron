import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
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
import { findContentTranslationGap } from "./content-languages.js";
import "./errors.js";

/**
 * What one of this extra costs on a line: the menu offer's price if that offer set one, else the
 * list item's own, else the product's `unitPrice` (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3).
 *
 * Only null and undefined fall through — `"0.00"` is a price a venue chose and is kept, which is
 * what makes a free bread expressible. VAT does not resolve this way at all: an extra always carries
 * its product's own rate.
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
// come from the `products` row it names (spec §3.1).
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
    const { listId, ...item } = row;
    const held = grouped.get(listId) ?? [];
    held.push(item);
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

/** The list exists. A plain read, taking no locks — the preview path's half of the pair below. */
async function assertExtraList(tx: Transaction, extraListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: extraLists.id })
    .from(extraLists)
    .where(eq(extraLists.id, extraListId));
  if (!list) throw new AppError("extras.not_found", { extraListId });
}

/**
 * The list exists, and this transaction holds its row until it ends, so two saves of the SAME list
 * run one after the other instead of overlapping — and so does a save racing a menu offer
 * publishing that list ({@link lockPublishedLists}). {@link writeItems} needs that: it replaces the
 * whole item set, and a `delete` cannot see another transaction's uncommitted inserts, so an
 * unserialised second save removes nothing and then collides on
 * `extra_list_items_list_product_uq` — a `23505` that leaves `writeItems` as a drizzle
 * `Failed query:` error carrying no `code`, which the server's error boundary answers as an opaque
 * 500.
 *
 * Measured on a real backend, because the two saves were already serialised by accident and the
 * measurement had to remove the accident: with this lock gone AND `updateExtraList`'s own `update`
 * of the list row moved after `writeItems`, "keeps the later of two overlapping saves of the same
 * list" (extras.pg.test.ts) reported `23505` for one of the two saves; putting this lock back, with
 * that `update` still moved, it passed. So what the lock buys is that `writeItems` no longer depends
 * on an unrelated statement's position for its correctness.
 *
 * This is a ROW lock, not an advisory one: spec §7 bars advisory locks from new code and does not
 * reach a `select … for update`, which is what `lockProduct` already takes on a product row
 * (variants.ts).
 */
async function lockExtraList(tx: Transaction, extraListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: extraLists.id })
    .from(extraLists)
    .where(eq(extraLists.id, extraListId))
    .for("update");
  if (!list) throw new AppError("extras.not_found", { extraListId });
}

/**
 * The staff `name` and `kitchenName` are plain text and need no translation check; the optional
 * customer-facing MAP is what must satisfy the configured content languages, and a null one is legal
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

/**
 * Replaces the list's items with the body's, in the body's order. An item the body omits is removed:
 * no foreign key anywhere references `extra_list_items` (2026-09-19,
 * `grep -rn 'REFERENCES "public"."extra_list_items"' --include='*.sql' packages apps` finds nothing),
 * the one thing that tracks an item by its PRODUCT instead is cleaned up separately
 * ({@link dropStaleMenuOverrides}), and
 * the design has an open order's child line point at the PRODUCT rather than back at the item
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4) — a path Task 7 of the plan
 * builds, so today there is nothing at all on the order side to check.
 *
 * EVERY item of the list is deleted and the body's are inserted fresh, each under the id the body
 * sent or a new one, so an item keeps its identity only because the body carries that id. Editing
 * the retained rows in place instead left an intermediate state a legal body could break:
 * `extra_list_items_list_product_uq` covers `(list_id, product_id)`, so a body exchanging two
 * retained items' products failed on the first update with `23505 duplicate key value` although its
 * final product set was fine. Seen red that way, on real PostgreSQL, by "saves a body that exchanges
 * two retained items' products" (extras.pg.test.ts).
 *
 * An id that names an item of a DIFFERENT list is refused as `extras.invalid` rather than moving
 * that item, and that refusal is decided on a plain `select`, which takes no row locks, before any
 * insert below. Two saves that each name the other list's item both read, both see the other's item
 * still there, and both refuse. Left to the insert's primary-key conflict instead, each save waits
 * on the other's uncommitted delete and PostgreSQL ends one of them with `40P01 deadlock detected`
 * in place of a domain refusal — measured on this code with the check removed, five runs out of
 * five, by "refuses both of two saves that each claim the other list's item, without deadlocking"
 * (extras.pg.test.ts).
 */
async function writeItems(
  tx: Transaction,
  extraListId: string,
  input: ExtraListInput,
): Promise<void> {
  await assertProductsExist(tx, input);
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
  // with a row it is replacing. Rows another transaction is writing are a separate problem, and one
  // this delete cannot see: every caller either holds the list's row lock ({@link lockExtraList}) or
  // has just minted the list id, so there are none.
  await tx.delete(extraListItems).where(eq(extraListItems.listId, extraListId));
  for (const [sort, item] of input.items.entries()) {
    // Each item's `sort` is its position in the body, so the order the editor sent is the order
    // `listExtraLists` and `getExtraList` read back.
    // The read above locks nothing, and the list's row lock serialises saves of THIS list only, so a
    // save of ANOTHER list can claim this id between the two. One that has already COMMITTED the id
    // is refused as a domain fault rather than surfacing as a driver error. The conflict clause
    // names the PRIMARY KEY: left untargeted, drizzle emits a bare `on conflict do nothing`, which
    // also absorbs an `extra_list_items_list_product_uq` collision and would report a product clash
    // as a stolen id. Still uncovered: two saves of DIFFERENT lists inserting the same NEW id each
    // wait on the other's uncommitted insert, and a mutual wait can still end as `40P01`. The
    // product index needs no such hedge — it is scoped to one `list_id`, which the row lock holds.
    const inserted = await tx
      .insert(extraListItems)
      .values({
        id: item.id ?? randomUUID(),
        listId: extraListId,
        productId: item.productId,
        maxQuantity: item.maxQuantity,
        preselected: item.preselected,
        price: item.price,
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

/**
 * The only write path here that takes no lock of its own on an existing list, and the reason is the
 * id: it is minted below and no other transaction can name it yet, so there is nothing to serialise
 * against. The others do take one — a row lock, not an advisory lock, which spec §7 bars from new
 * code ({@link lockExtraList}): `updateExtraList` and `deleteExtraList` take exactly one each, and
 * `setMenuItemExtraLists` takes one per PUBLISHED LIST, so none at all when the body publishes
 * nothing. The content-language lock `validateNames` reaches through is the existing shared one.
 */
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
  await lockExtraList(tx, extraListId);
  await validateNames(tx, input, fallbackLanguage);
  await tx.update(extraLists).set(listValues(input)).where(eq(extraLists.id, extraListId));
  await writeItems(tx, extraListId, input);
  // Only here, and not in {@link createExtraList}: that path mints the list id a statement earlier,
  // so no menu offer can hold an override against it yet.
  await dropStaleMenuOverrides(tx, extraListId, input);
  return getExtraList(tx, extraListId);
}

export async function deleteExtraList(tx: Transaction, extraListId: string): Promise<void> {
  await lockExtraList(tx, extraListId);
  // Three sets of rows go with it, all by ON DELETE CASCADE: the list's items through
  // `extra_list_items_list_fk` (drizzle/0004_extra_lists.sql:24), every menu offer's publication of
  // it through `menu_item_extra_lists_list_fk` (drizzle/0008_menu_extra_publication.sql:21) and,
  // under those, each offer's per-item overrides through `menu_item_extra_items_list_fk`
  // (drizzle/0008_menu_extra_publication.sql:18). Run
  // rather than read off the clauses, by "takes the publication and its overrides with it when the
  // list is deleted" (extra-projection.test.ts). There is no open-order check, because the design
  // has an open order's child line carry the product rather than the list (spec §3.5, §3.4) — and
  // that order path is Task 7 of the plan, unbuilt today.
  await tx.delete(extraLists).where(eq(extraLists.id, extraListId));
}

/**
 * Every published list exists, and this transaction holds each of their rows until it ends — so a
 * save of one of those lists cannot land between {@link assertProductsOffered}'s membership read and
 * the override rows written below. Without it, a manager's override for a product the list dropped
 * in that window is written anyway and comes back the moment the product is offered again: measured
 * on a real backend by "does not keep a menu price for a product the list stopped offering while it
 * was saving" (extras.pg.test.ts), which read `0.25` where the product's own `2.50` was due.
 *
 * LOCK ORDER is what keeps two writers from waiting on each other for ever. The next two paragraphs
 * are REASONING over the write paths named below, traced by hand; they are not a measurement, and
 * they say nothing about a path outside this file. Only the sort's paragraph is measured.
 *
 * Three locks are taken deliberately, and each path takes the ones it needs in this order: the menu
 * OFFER's row in `menu_items` (the only one of these paths that takes it), then `extra_lists` rows
 * in ascending id order ({@link lockExtraList}), then the content-languages ADVISORY lock, which
 * `validateNames` reaches through `findContentTranslationGap` (content-languages.ts) and only when
 * the body carries a customer-facing name. `setMenuItemExtraLists` takes the first two;
 * `updateExtraList` takes one list row and then the advisory lock; `deleteExtraList` takes one list
 * row and neither of the other two; `createExtraList` takes the advisory lock and no EXISTING list
 * row at all — the `extra_lists` row it locks after that is one it has just minted, which no other
 * transaction can name yet.
 *
 * Below those, each path's own writes take ordinary row locks this code does not order: the list's
 * `extra_list_items` rows, and its `menu_item_extra_items` rows — reached directly by
 * {@link dropStaleMenuOverrides}, which sweeps ONE list across every offer, and by the cascade under
 * `setMenuItemExtraLists`'s publication delete, which sweeps ONE offer across every list. Those two
 * sweeps cross, so nothing here claims they cannot wait on each other. What the paragraph above
 * claims is narrower: no path waits on one of the three deliberate locks while holding a row lock
 * from this one.
 *
 * The ascending sort is the part that IS measured, on real PostgreSQL in this worktree. With
 * `.sort()` removed and a 300ms pause after each acquired lock, two menu offers publishing the same
 * two lists in OPPOSITE body order ended one of the two in `40P01 deadlock detected` — three runs of
 * three; with the sort put back and the pause still in place, both completed — three runs of three.
 *
 * An unknown list id is refused from inside this loop, as `extras.not_found`
 * ({@link lockExtraList}), so the id the refusal names is the lowest unknown one in string order
 * rather than the first unknown one in body order. No test pins which.
 *
 * One statement per id rather than one `in (…) order by id for update`: the order the rows are
 * locked in is the whole point here, and a loop makes it this code's choice rather than a query
 * plan's. The count is the number of lists ONE menu offer publishes.
 */
async function lockPublishedLists(
  tx: Transaction,
  publications: MenuExtraPublication[],
): Promise<void> {
  // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3), and in turn is
  // also what makes the order above real.
  for (const listId of publications.map((publication) => publication.listId).sort())
    await lockExtraList(tx, listId);
}

/**
 * Every list the body publishes is one the dish's PRODUCT carries in `product_modifiers` — ONE of
 * the two checks `setMenuItemOptionGroups` (operations.ts) makes against `product_option_groups`,
 * the one it refuses as `options.group_invalid` with `reason: "not_attached"`. Its OTHER check has
 * no twin here: that one refuses a body which LEAVES OUT a group the product marks required
 * (`reason: "required_group_missing"`), and nothing on the extras side refuses an offer that
 * publishes none of the lists its product carries. Whether it should is open, not decided here —
 * an extras list has no `required` flag to read (the spec makes "required" `min_picks >= 1`, §3.1),
 * and §3.2 says only which lists an offer publishes, never that a required one must be among them.
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
 * item when `available` is false. That is the opposite of `menu_item_options`, where a choice is
 * offered only if a row exists (`projectModifier`, modifier-projection.ts). Two reasons it differs:
 * the row carries an explicit `available` flag, which `menu_item_options` has no column for, so
 * narrowing has its own place and row presence does not have to carry it; and §3.2 says a menu offer
 * MAY narrow and reprice, so an offer that narrows nothing offers the whole list.
 *
 * **A list the dish's product does not carry is refused** ({@link assertProductCarries}) — the
 * `not_attached` half of what `setMenuItemOptionGroups` (operations.ts) checks against
 * `product_option_groups`. Its `required_group_missing` half has no twin here, for the reason
 * {@link assertProductCarries} gives.
 *
 * The existence read takes the menu offer's ROW LOCK, so two saves of the SAME offer run one after
 * the other rather than overlapping. NOT measured on this path: the receipt is for the same
 * delete-then-insert shape one table over, and it is on {@link lockExtraList}. The lists published
 * are locked next, in id order, for the reason {@link lockPublishedLists} gives.
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
    .where(eq(menuItems.id, offerId))
    .for("update");
  if (offer === undefined) throw new AppError("menu_item.not_found", { menuItemId });
  const publications = parseMenuExtraPublications(lists);
  await lockPublishedLists(tx, publications);
  // Both reads sit AFTER the offer's row lock and the lists' row locks, never before: an answer
  // read ahead of a lock this path then waits for can be stale by the time the wait ends. Neither
  // read locks `product_modifiers` itself, so a product's attachment list can still change between
  // the first of them and the commit — with ONE exception. A save that ATTACHES a list this body
  // publishes can no longer overlap this path: `writeProductModifiers` (product-modifiers.ts)
  // takes `for key share` on every `extra_lists` row it names, `lockExtraList` above takes
  // `for update` on the same rows, and the two conflict, so whichever transaction is second waits
  // for the first. MEASURED on PostgreSQL 18.4: a `for update` on a row another session held
  // `for key share` blocked until a 2s `lock_timeout`, while the same `for update` with nothing
  // held returned at once and a second `for key share` never waited at all. A save that DETACHES a
  // list does not name it and so locks nothing, so that change is still invisible here. Both paths
  // take `extra_lists` rows in ascending id order and neither wants a row the other holds
  // afterwards, so this is a wait and not a deadlock — that last part traced over the two files,
  // not run.
  // Carrying the list comes first: a body that publishes a list the dish does not have is wrong
  // about the list, whatever its overrides then say.
  await assertProductCarries(tx, offer.productId, publications);
  await assertProductsOffered(tx, publications);

  // The offer's item rows go with its list rows, through `menu_item_extra_items_list_fk`
  // (drizzle/0008_menu_extra_publication.sql:18), so this one delete clears both tables for this
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
      price: item.price,
      available: item.available,
    })),
  );
  if (items.length > 0) await tx.insert(menuItemExtraItems).values(items);
}

export interface ExtraListDependants {
  products: { id: string; name: string }[];
  menus: { id: string; name: string }[];
}

/**
 * What deleting this list would touch — the preview a delete confirmation reads. Both sides are
 * detached by the delete rather than blocking it, and no order is consulted: an open order's child
 * line points at the PRODUCT, not at the list
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.5, §3.4).
 *
 * The two sides are not the same kind of thing. A MENU publishes the list in its own right, through
 * `menu_item_extra_lists` (§3.2) — unlike an options list, which has no per-menu row at all. A
 * publication has no name of its own, so it is identified by the menu ITEM's id and the staff name
 * of the product that dish is, exactly as `modifierDependants` (modifiers.ts) identifies one.
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
