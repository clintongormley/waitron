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

// A LIST's `sort` is never written from a body (`parseOptionListInput` does not accept it), so the
// id decides list order. A LABEL's `sort` is its position in the body (`writeLabels`).
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
 * Only the optional customer-facing MAP must have text in the venue's default content language; a
 * null one is legal because it falls back to `name`. The refusal carries the offending map's dotted
 * field path, so an editor can put it beside the input.
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

// Taken as "the rest" rather than field by field, so a column added to `OptionListInput` cannot be
// left unwritten.
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
    const inserted = await tx
      .insert(optionLabels)
      .values({ id: label.id ?? randomUUID(), listId: optionListId, ...values })
      .onConflictDoNothing()
      .returning({ id: optionLabels.id });
    if (!inserted.length) throw new AppError("options.invalid", { field: `labels.${sort}.id` });
  }
}

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
  // Stored ids are lower-case and an id column compares byte for byte (packages/shared/src/ids.ts).
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
  // The labels go with it through `option_labels_list_fk`'s cascade. There is no open-order check:
  // an order line carries the chosen names as text and points at nothing here (spec §2.3).
  await tx.delete(optionLists).where(eq(optionLists.id, optionListId));
}

export type { OptionListDependants } from "./modifier-list-types.js";

/**
 * What deleting this list would touch — the preview a delete confirmation reads. Both sides are
 * detached by the delete rather than blocking it: the `product_modifiers` key cascades, and an
 * order line carries the chosen names as text and points at nothing here (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.3).
 *
 * Options lists have no per-menu row at all (spec §2.2), so `menus` is every menu offer of a dish
 * that holds the list, named by that product's staff name. An INACTIVE offer is listed like any
 * other. Products come back alphabetical by staff name with the id breaking a tie; menus in
 * offer-id order.
 *
 * ``grep -rn 'REFERENCES `option_l' --include='*.sql' packages apps`` prints two keys, both into
 * `option_lists`: `option_labels`' and `product_modifiers`'. No foreign key references `option_labels`.
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
