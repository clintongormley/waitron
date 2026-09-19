import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { extraListItems, extraLists } from "./schema/extras.js";
import {
  parseExtraListInput,
  type ExtraList,
  type ExtraListItem,
  type ExtraListInput,
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
 */
export function resolveExtraPrice(
  item: ExtraListItem,
  product: { unitPrice: string },
  menuPrice?: string | null,
): string {
  return menuPrice ?? item.price ?? product.unitPrice;
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

export async function listExtraLists(tx: Transaction): Promise<ExtraList[]> {
  const lists = await tx
    .select(listColumns)
    .from(extraLists)
    .orderBy(extraLists.sort, extraLists.id);
  if (lists.length === 0) return [];
  // One query for every list's items, never one per list.
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

export async function getExtraList(tx: Transaction, extraListId: string): Promise<ExtraList> {
  const [list] = await tx
    .select(listColumns)
    .from(extraLists)
    .where(eq(extraLists.id, extraListId));
  if (!list) throw new AppError("extras.not_found", { extraListId });
  const items = await tx
    .select(itemColumns)
    .from(extraListItems)
    .where(eq(extraListItems.listId, extraListId))
    .orderBy(extraListItems.sort, extraListItems.id);
  return { ...list, items };
}

async function assertExtraList(tx: Transaction, extraListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: extraLists.id })
    .from(extraLists)
    .where(eq(extraLists.id, extraListId));
  if (!list) throw new AppError("extras.not_found", { extraListId });
}

/**
 * The staff `name` and `kitchenName` are plain text and need no translation check; the optional
 * customer-facing MAP is what must satisfy the configured content languages, and a null one is legal
 * because it falls back to `name` — the rule `setProductVariants` follows (variants.ts).
 *
 * An extras list holds exactly ONE such map, where an options list holds one per label as well as
 * its own: an item names a product and carries no name of its own (extra-contract.ts's
 * `ExtraListItem`), so the field path this reports is always `"customerName"`. Nothing is thrown by
 * `findContentTranslationGap` — it RETURNS which map has the gap — and the throw below attaches the
 * field path, so an editor can put the refusal beside the input.
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
 * plain string match because both sides are lower-cased: the contract's `id`
 * (extra-contract.ts) lower-cases what the body sent, and a `uuid` column hands its value back
 * lower-cased whatever case it was written in.
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
 * nothing outside these two tables names an extras list item (see {@link extraListDependants}), and
 * the design has an open order's child line point at the PRODUCT rather than back at the item
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4) — a path Task 8 of the plan
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
  // The list starts from nothing, so no row the body keeps can collide with a row it is replacing.
  await tx.delete(extraListItems).where(eq(extraListItems.listId, extraListId));
  for (const [sort, item] of input.items.entries()) {
    // Each item's `sort` is its position in the body, so the order the editor sent is the order
    // `listExtraLists` and `getExtraList` read back.
    // The read above locks nothing, so another transaction can claim this id between it and here.
    // An id another transaction has already COMMITTED is refused as a domain fault rather than
    // surfacing as a driver error. The conflict clause names the PRIMARY KEY: left untargeted,
    // drizzle emits a bare `on conflict do nothing`, which also absorbs a
    // `extra_list_items_list_product_uq` collision and would report a product clash as a stolen id.
    // Two transactions inserting the same NEW id are not covered: each waits on the other's
    // uncommitted insert, and a mutual wait can still end as `40P01`.
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
 * Nothing here takes a lock of its own on the list or its items: spec §7 bars advisory locks from
 * new code, which is the same decision `createOptionList` records (options.ts). The
 * content-language lock `validateNames` reaches through is the existing shared one.
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
  // Lower-cased once, here, and used from here on. A `uuid` column compares either case and hands
  // its value back lower-cased, so an upper-cased id finds the list in SQL but does not match the
  // stored `list_id` that `writeItems` compares in JavaScript — which classified every one of the
  // list's own items as another list's. Same normalisation the contract's `id` applies to what a
  // body sends (extra-contract.ts).
  const extraListId = callerListId.toLowerCase();
  // The list has to exist before its name is worth checking, or updating an id that names nothing
  // reports a translation problem for a list that is not there.
  await assertExtraList(tx, extraListId);
  await validateNames(tx, input, fallbackLanguage);
  await tx.update(extraLists).set(listValues(input)).where(eq(extraLists.id, extraListId));
  await writeItems(tx, extraListId, input);
  return getExtraList(tx, extraListId);
}

export async function deleteExtraList(tx: Transaction, extraListId: string): Promise<void> {
  await assertExtraList(tx, extraListId);
  // The items go with it through `extra_list_items_list_fk` ... ON DELETE CASCADE
  // (drizzle/0004_extra_lists.sql:24). There is no open-order check, because the design has an open
  // order's child line carry the product rather than the list (spec §3.5, §3.4) — and that order
  // path is Task 8 of the plan, unbuilt today.
  await tx.delete(extraLists).where(eq(extraLists.id, extraListId));
}

export interface ExtraListDependants {
  products: { id: string; name: string }[];
  menus: { id: string; name: string }[];
}

/**
 * What deleting this list would touch — the preview a delete confirmation reads.
 *
 * The two sides are not the same kind of thing. A PRODUCT holds the list, through the attachment
 * table Task 6 of `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` adds. A MENU
 * publishes it in its own right, through the per-menu tables Task 5 adds
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.2) — unlike an options list,
 * which has no per-menu row at all.
 *
 * Both sides are empty today because nothing can hold a list yet. Receipt, over the generated
 * migrations: `grep -rn 'REFERENCES "public"."extra_l' --include='*.sql' packages apps` returns one
 * line, `extra_list_items`' own key into `extra_lists` (drizzle/0004_extra_lists.sql:24). No other
 * table has a key into either of these two.
 */
export async function extraListDependants(
  tx: Transaction,
  extraListId: string,
): Promise<ExtraListDependants> {
  await assertExtraList(tx, extraListId);
  return { products: [], menus: [] };
}
