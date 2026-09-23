import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { optionLabels, optionLists } from "./schema/options.js";
import { productModifiers } from "./schema/extras.js";
import { menuItems } from "./schema/menu.js";
import {
  parseOptionListInput,
  type OptionLabel,
  type OptionList,
  type OptionListInput,
} from "./option-contract.js";
import type { OptionListDependants } from "./modifier-list-types.js";
import { findContentTranslationGap } from "./content-languages.js";
import "./errors.js";

// A LIST's `sort` is read but never written from a body: it is not one of the keys
// `parseOptionListInput` accepts, so every list saved here keeps the column default and the id
// decides the order. A LABEL's `sort` is different — `writeLabels` writes it from the label's
// position in the body.
const listColumns = {
  id: optionLists.id,
  name: optionLists.name,
  customerName: optionLists.customerName,
  kitchenName: optionLists.kitchenName,
  defaultLabelId: optionLists.defaultLabelId,
  active: optionLists.active,
};
const labelColumns = {
  id: optionLabels.id,
  name: optionLabels.name,
  customerName: optionLabels.customerName,
  kitchenName: optionLabels.kitchenName,
  available: optionLabels.available,
};

/** One query for every list's labels, never one per list, whatever the number of lists. */
async function withLabels(
  tx: Transaction,
  lists: Omit<OptionList, "labels">[],
): Promise<OptionList[]> {
  if (lists.length === 0) return [];
  const rows = await tx
    .select({ listId: optionLabels.listId, ...labelColumns })
    .from(optionLabels)
    .where(
      inArray(
        optionLabels.listId,
        lists.map((list) => list.id),
      ),
    )
    .orderBy(optionLabels.sort, optionLabels.id);
  const grouped = new Map<string, OptionLabel[]>();
  for (const row of rows) {
    const { listId, ...label } = row;
    const held = grouped.get(listId) ?? [];
    held.push(label);
    grouped.set(listId, held);
  }
  return lists.map((list) => ({ ...list, labels: grouped.get(list.id) ?? [] }));
}

export async function listOptionLists(tx: Transaction): Promise<OptionList[]> {
  const lists = await tx
    .select(listColumns)
    .from(optionLists)
    .orderBy(optionLists.sort, optionLists.id);
  return withLabels(tx, lists);
}

/**
 * The named lists, in the order {@link listOptionLists} returns them, each with its labels. Two
 * queries whatever the number of ids, and none at all for an empty one. An id naming no list is
 * simply absent from the answer.
 *
 * The order path wants exactly the lists one dish attaches rather than the whole catalogue's: it has
 * to freeze a chosen label's three names onto the order line, and what it holds is the option-list
 * ids from `readProductModifiers` (product-modifiers.ts). Reading every list instead would be a
 * third query whose cost grows with the catalogue rather than with the dish. This is the options
 * twin of `readExtraListsByIds` (extras.ts).
 */
export async function readOptionListsByIds(
  tx: Transaction,
  optionListIds: string[],
): Promise<OptionList[]> {
  if (optionListIds.length === 0) return [];
  const lists = await tx
    .select(listColumns)
    .from(optionLists)
    .where(inArray(optionLists.id, optionListIds))
    .orderBy(optionLists.sort, optionLists.id);
  return withLabels(tx, lists);
}

/** One list with its labels, or `options.not_found`. The twin of `getExtraList` (extras.ts). */
export async function getOptionList(tx: Transaction, optionListId: string): Promise<OptionList> {
  const [list] = await readOptionListsByIds(tx, [optionListId]);
  if (!list) throw new AppError("options.not_found", { optionListId });
  return list;
}

async function assertOptionList(tx: Transaction, optionListId: string): Promise<void> {
  const [list] = await tx
    .select({ id: optionLists.id })
    .from(optionLists)
    .where(eq(optionLists.id, optionListId));
  if (!list) throw new AppError("options.not_found", { optionListId });
}

/**
 * The staff `name` and `kitchenName` are plain text and need no translation check; the optional
 * customer-facing MAP is what must satisfy the configured content languages, and a null one is legal
 * because it falls back to `name` — the rule `setProductVariants` follows (variants.ts).
 *
 * One save submits a map for the list and one per label, so they go to the database TOGETHER: the
 * plural check takes the content-language advisory lock and reads the configuration once for all of
 * them. Nothing is thrown down there — `findContentTranslationGap` RETURNS which map has the gap —
 * and the throw below attaches that map's dotted field path, so an editor can put the refusal beside
 * the input. (`metadata` in `packages/media/src/images.ts` reaches a comparable code the other way
 * round: it catches the `content.translation_required` that `validateContentTranslations` throws for
 * its single map and re-throws it as `image.translation_required`.)
 */
async function validateNames(
  tx: Transaction,
  input: OptionListInput,
  fallbackLanguage: string,
): Promise<void> {
  const named = [
    { field: "customerName", map: input.customerName },
    ...input.labels.map((label, index) => ({
      field: `labels.${index}.customerName`,
      map: label.customerName,
    })),
  ].filter((entry): entry is { field: string; map: Record<string, string> } => entry.map != null);
  // A list carrying no customer-facing name at all, on itself or on any label, has nothing to check
  // and so touches the database not at all — no lock, no read.
  if (named.length === 0) return;
  const gap = await findContentTranslationGap(
    tx,
    named.map((entry) => entry.map),
    fallbackLanguage,
  );
  if (gap !== null)
    throw new AppError("options.translation_required", {
      field: named[gap.index]!.field,
      language: gap.language,
    });
}

// Everything on the body EXCEPT the labels, which live in their own table. Taken as "the rest"
// rather than field by field, so a column added to `OptionListInput` later cannot be left unwritten.
function listValues(input: OptionListInput) {
  const { labels, ...values } = input;
  void labels; // discarded on purpose; the lint rule does not exempt a rest sibling
  return values;
}

/**
 * Replaces the list's labels with the body's, in the body's order. A label the body omits is
 * removed: nothing outside these two tables names an options label, so there is no usage to check
 * (see {@link optionListDependants}), and an order line copies the names as text rather than
 * pointing back by id (spec §2.3).
 *
 * A body label carrying the id of a label this list already holds is updated in place; one with no
 * id, or with an id nothing holds, is inserted. An id that names a label of a DIFFERENT list is
 * refused as `options.invalid` rather than moving that label.
 *
 * That refusal is decided BEFORE the delete below, on a plain `select`, which takes no row locks.
 * The ordering is the point: two saves that each name the other list's label both read, both see the
 * other's label still there, and both refuse. Deciding it later instead — at the insert's
 * primary-key conflict — left each save waiting on the other's uncommitted delete, and PostgreSQL
 * ended one of them with `40P01 deadlock detected` in place of a domain refusal. Receipt in the
 * branch's review thread.
 */
async function writeLabels(
  tx: Transaction,
  optionListId: string,
  input: OptionListInput,
): Promise<void> {
  const bodyIds = input.labels.flatMap((label) => (label.id === undefined ? [] : [label.id]));
  const existing = bodyIds.length
    ? await tx
        .select({ id: optionLabels.id, listId: optionLabels.listId })
        .from(optionLabels)
        .where(inArray(optionLabels.id, bodyIds))
    : [];
  const foreign = new Set(
    existing.filter((row) => row.listId !== optionListId).map((row) => row.id),
  );
  if (foreign.size) {
    const at = input.labels.findIndex((label) => label.id !== undefined && foreign.has(label.id));
    throw new AppError("options.invalid", { field: `labels.${at}.id` });
  }
  // What the body does not name is this list's to remove; `bodyIds` cannot name another list's label
  // by the check above, so every id in it that exists is one of this list's own.
  await tx
    .delete(optionLabels)
    .where(
      bodyIds.length
        ? and(eq(optionLabels.listId, optionListId), notInArray(optionLabels.id, bodyIds))
        : eq(optionLabels.listId, optionListId),
    );
  const heldIds = new Set(existing.map((row) => row.id));
  for (const [sort, label] of input.labels.entries()) {
    // Each label's `sort` is its position in the body, so the order the editor sent is the order
    // `listOptionLists` and `getOptionList` read back.
    const values = {
      name: label.name,
      customerName: label.customerName,
      kitchenName: label.kitchenName,
      available: label.available,
      sort,
    };
    if (label.id !== undefined && heldIds.has(label.id)) {
      await tx
        .update(optionLabels)
        .set(values)
        .where(and(eq(optionLabels.listId, optionListId), eq(optionLabels.id, label.id)));
      continue;
    }
    // The read above locks nothing, so another transaction can claim this id between it and here.
    // An id another transaction has already COMMITTED is refused as a domain fault rather than
    // surfacing as a driver error. Two transactions inserting the same NEW id are not covered: each
    // waits on the other's uncommitted insert, and a mutual wait can still end as `40P01`.
    const inserted = await tx
      .insert(optionLabels)
      .values({ id: label.id ?? randomUUID(), listId: optionListId, ...values })
      .onConflictDoNothing()
      .returning({ id: optionLabels.id });
    if (!inserted.length) throw new AppError("options.invalid", { field: `labels.${sort}.id` });
  }
}

/**
 * Nothing here takes a lock of its own on the list or its labels, and that is a decision rather
 * than an omission: the plan's Task 2 Step 6 says "No advisory lock, no order check", and spec §7
 * bars advisory locks from new code because the SQLite switch's single write queue makes them
 * redundant. `setProductVariants` (variants.ts) takes no lock of its own either — the row lock it
 * used to take on the product went with the engine, and `variants.ts` says why. What
 * `validateNames` reaches through is no longer a lock at all: `content-languages.ts` records that
 * the write queue arranges what an advisory lock there used to.
 */
export async function createOptionList(
  tx: Transaction,
  value: unknown,
  fallbackLanguage: string,
): Promise<OptionList> {
  const input = parseOptionListInput(value);
  await validateNames(tx, input, fallbackLanguage);
  const optionListId = randomUUID();
  await tx.insert(optionLists).values({ id: optionListId, ...listValues(input) });
  await writeLabels(tx, optionListId, input);
  return getOptionList(tx, optionListId);
}

export async function updateOptionList(
  tx: Transaction,
  callerListId: string,
  value: unknown,
  fallbackLanguage: string,
): Promise<OptionList> {
  const input = parseOptionListInput(value);
  // Lower-cased once, here, and used from here on. A `uuid` column compares either case and hands
  // its value back lower-cased, so an upper-cased id finds the list in SQL but does not match the
  // stored `list_id` that `writeLabels` compares in JavaScript — which classified every one of the
  // list's own labels as another list's. Same normalisation the contract's `id` applies to what a
  // body sends (option-contract.ts).
  const optionListId = callerListId.toLowerCase();
  // The list has to exist before its names are worth checking, or updating an id that names nothing
  // reports a translation problem for a list that is not there.
  await assertOptionList(tx, optionListId);
  await validateNames(tx, input, fallbackLanguage);
  await tx.update(optionLists).set(listValues(input)).where(eq(optionLists.id, optionListId));
  await writeLabels(tx, optionListId, input);
  return getOptionList(tx, optionListId);
}

export async function deleteOptionList(tx: Transaction, optionListId: string): Promise<void> {
  await assertOptionList(tx, optionListId);
  // The labels go with it through `option_labels_list_fk` ... ON DELETE CASCADE
  // (drizzle/0000_catalogue_baseline.sql). There is no open-order check: an order line carries the
  // chosen names as text and points at nothing here (spec §2.3).
  await tx.delete(optionLists).where(eq(optionLists.id, optionListId));
}

// The shape lives in `modifier-list-types.ts`, the browser-safe LEAF the dashboard imports; this
// file keeps the code that builds it and re-exports the type so existing imports are unchanged.
export type { OptionListDependants } from "./modifier-list-types.js";

/**
 * What deleting this list would touch — the preview a delete confirmation reads. Both sides are
 * detached by the delete rather than blocking it: `product_modifiers_option_list_fk` is
 * ON DELETE CASCADE (drizzle/0000_catalogue_baseline.sql), and an order line carries the chosen
 * names as text and points at nothing here (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.3).
 *
 * The two sides are not the same kind of thing. A PRODUCT holds the list, through
 * `product_modifiers` (spec §5). A MENU only shows a dish that holds it — options lists have no
 * per-menu row at all (spec §2.2) — so `menus` walks the same attachment rows on to `menu_items`
 * rather than having a table of its own to read, which is where it differs from the extras twin
 * (`extraListDependants`, extras.ts). Each offer is named by the staff name of the product that
 * dish is, exactly as that twin does.
 *
 * ONE query for both sides, not two: every menu offer of a carrying dish hangs off the same
 * attachment row the product side already resolved, so a second query would filter
 * `product_modifiers` on the same list id and re-join `products` on the same product. The extras
 * twin cannot be folded the same way — its menu side reads a table of its own,
 * `menu_item_extra_lists`, which is not reached through the attachment rows at all.
 *
 * Receipt for "no other table points at an options list", over the generated migrations:
 * `grep -rn 'REFERENCES "public"."option_l' --include='*.sql' packages apps` returns two lines,
 * `option_labels`' own key into `option_lists` and `product_modifiers`' own, both in
 * drizzle/0000_catalogue_baseline.sql.
 *
 * The products come back alphabetical by staff name with the id breaking a tie, so a confirmation
 * dialog reads in a fixed order whichever ids were minted; the menus in offer-id order, as the
 * extras twin's do. An INACTIVE menu offer is listed like any other — deleting the list detaches
 * it either way.
 *
 * The products' order is the query's; the menus are sorted here, because one query has one
 * `order by` and the product side has the claim on it. A JavaScript string sort reproduces what
 * `order by menu_items.id` gave: PostgreSQL orders a `uuid` by its sixteen bytes, and the
 * canonical lower-cased hex text compares the same way. MEASURED on PostgreSQL 18 rather than read
 * off the documentation — 2000 `gen_random_uuid()` values, `string_agg(u::text, ',' order by u)`,
 * compared with the same list sorted in JavaScript: identical, and a control with one adjacent
 * pair swapped reported a difference.
 */
export async function optionListDependants(
  tx: Transaction,
  optionListId: string,
): Promise<OptionListDependants> {
  await assertOptionList(tx, optionListId);
  // A LEFT join on the offers: a carrying dish that is on no menu still has to reach the products
  // side, and one that is on several menus contributes one row per offer.
  const rows = await tx
    .select({ productId: products.id, name: products.name, menuItemId: menuItems.id })
    .from(productModifiers)
    .innerJoin(products, eq(products.id, productModifiers.productId))
    .leftJoin(menuItems, eq(menuItems.productId, productModifiers.productId))
    .where(eq(productModifiers.optionListId, optionListId))
    .orderBy(products.name, products.id);
  const carrying = new Map<string, { id: string; name: string }>();
  const menus: { id: string; name: string }[] = [];
  for (const row of rows) {
    // A dish on two menus arrives twice; the map keeps the query's order and the first of the pair.
    carrying.set(row.productId, { id: row.productId, name: row.name });
    if (row.menuItemId !== null) menus.push({ id: row.menuItemId, name: row.name });
  }
  menus.sort((left, right) => (left.id < right.id ? -1 : 1));
  return { products: [...carrying.values()], menus };
}
