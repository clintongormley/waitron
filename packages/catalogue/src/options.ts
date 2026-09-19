import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { optionLabels, optionLists } from "./schema/options.js";
import {
  parseOptionListInput,
  type OptionLabel,
  type OptionList,
  type OptionListInput,
} from "./option-contract.js";
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

export async function listOptionLists(tx: Transaction): Promise<OptionList[]> {
  const lists = await tx
    .select(listColumns)
    .from(optionLists)
    .orderBy(optionLists.sort, optionLists.id);
  if (lists.length === 0) return [];
  // One query for every list's labels, never one per list.
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

export async function getOptionList(tx: Transaction, optionListId: string): Promise<OptionList> {
  const [list] = await tx
    .select(listColumns)
    .from(optionLists)
    .where(eq(optionLists.id, optionListId));
  if (!list) throw new AppError("options.not_found", { optionListId });
  const labels = await tx
    .select(labelColumns)
    .from(optionLabels)
    .where(eq(optionLabels.listId, optionListId))
    .orderBy(optionLabels.sort, optionLabels.id);
  return { ...list, labels };
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
 * primary-key conflict, which is where `writeChoices` decides the same thing about a stolen choice
 * id (modifiers.ts) — left each save waiting on the other's uncommitted delete, and PostgreSQL ended
 * one of them with `40P01 deadlock detected` in place of a domain refusal. Receipt in the branch's
 * review thread.
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
 * Nothing here takes a lock of its own on the list or its labels. The modifier path this replaces
 * does, and not per row: `createModifier`/`updateModifier`/`deleteModifier` (modifiers.ts) call
 * `lockModifierDefinitions` (modifier-lock.ts), which is one advisory lock on a constant key
 * covering every modifier definition at once. `setProductVariants` (variants.ts) takes no advisory
 * lock either — its `lockProduct` is a `select … for update` on the product row. Going without is a
 * decision, not an omission: the plan's Task 2 Step 6 says "No advisory lock, no order check", and
 * spec §7 bars advisory locks from new code because the SQLite switch's single write queue makes
 * them redundant. The content-language lock `validateNames` reaches through is the existing shared
 * one.
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
  // (drizzle/0002_option_lists.sql:21). There is no open-order check: an order line carries the
  // chosen names as text and points at nothing here (spec §2.3).
  await tx.delete(optionLists).where(eq(optionLists.id, optionListId));
}

export interface OptionListDependants {
  products: { id: string; name: string }[];
  menus: { id: string; name: string }[];
}

/**
 * What deleting this list would touch — the preview a delete confirmation reads.
 *
 * The two sides are not the same kind of thing. A PRODUCT holds the list, through the attachment
 * table Task 6 of `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` adds. A MENU only
 * shows a dish that holds it — options lists have no per-menu row at all
 * (`docs/superpowers/specs/2026-09-18-one-product-model-design.md` §2.2), so `menus` is reached
 * through the products, never queried directly.
 *
 * Both sides are empty today because nothing can hold a list yet. Receipt, over the generated
 * migrations: `grep -rn 'REFERENCES "public"."option_l' --include='*.sql' packages apps` returns one
 * line, `option_labels`' own key into `option_lists` (drizzle/0002_option_lists.sql:21). No other
 * table has a key into either of these two.
 */
export async function optionListDependants(
  tx: Transaction,
  optionListId: string,
): Promise<OptionListDependants> {
  await assertOptionList(tx, optionListId);
  return { products: [], menus: [] };
}
