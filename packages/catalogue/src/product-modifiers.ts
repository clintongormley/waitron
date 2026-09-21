import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { extraLists, productModifiers } from "./schema/extras.js";
import { optionLists } from "./schema/options.js";
import type { ProductModifierRef } from "./product-types.js";
import "./errors.js";

// The shape itself lives in `product-types.ts` with the other wire shapes, because the dashboard
// imports it and this file imports drizzle and `@waitron/db`. Re-exported so `product-modifiers.js`
// stays the import path it was.
export type { ProductModifierRef } from "./product-types.js";

/**
 * The two kinds of list a product's attachment list can name. A catalogue FACT, declared once: the
 * product-editor parser (`parseProductEditorInput`, product-editor-input.ts) and the management
 * API's body screen (`parseProductModifiers`, apps/server/src/catalogue-api.ts) both decide what
 * to refuse from it, so a third kind is added here and nowhere else.
 *
 * It is NOT in `product-types.ts` with the {@link ProductModifierRef} shape itself: that file is a
 * browser leaf that must emit no runtime code at all, and a `const` there fails
 * `scripts/dashboard-browser-purity.test.ts`. The `satisfies` below ties the two together in ONE
 * direction — a kind added here that the type does not have fails to compile, while a kind added
 * to the TYPE and not here compiles fine, and would then be refused by both parsers.
 */
export const MODIFIER_LIST_KINDS = [
  "extras",
  "options",
] as const satisfies readonly ProductModifierRef["kind"][];

/** Whether an untrusted value is one of {@link MODIFIER_LIST_KINDS}, narrowing it when it is. */
export function isModifierListKind(value: unknown): value is ProductModifierRef["kind"] {
  return typeof value === "string" && (MODIFIER_LIST_KINDS as readonly string[]).includes(value);
}

/**
 * A uuid column compares either case in SQL and hands its value back LOWER-CASED, so an id also
 * compared in JAVASCRIPT has to be lower-cased first, or it finds its row in SQL and then matches
 * nothing in a set. Every LIST id is normalised here, at the boundary, because the two checks in
 * {@link assertRefsExist} compare them — deleting this call turns "refuses a duplicate that
 * differs only in case" and "matches a list id the caller sent in upper case"
 * (product-modifiers.test.ts) red. `updateExtraList` (extras.ts) and `updateOptionList`
 * (options.ts) normalise their caller's id for the same reason.
 *
 * The PRODUCT id is deliberately NOT normalised: nothing here compares it in JavaScript, it only
 * ever reaches SQL, and the file was run both ways with no test able to tell.
 */
const normalise = (value: string) => value.toLowerCase();

/**
 * Every named product's attachment list, in `sort` order, keyed by product id.
 *
 * The keys, and every list id in the values, are the LOWER-CASED form the uuid columns hand back,
 * whatever case the caller asked in — so a caller holding an upper-cased product id has to
 * lower-case it before looking one up. `readProductEditor` (product-editor.ts) does exactly that;
 * `readProductExtras` (extra-projection.ts) hands the keys on as its own, and `listProducts`
 * (operations.ts) looks up ids that came straight out of the database and are lower-cased already.
 *
 * A product with NO attachments has no entry at all — not an empty array. Callers read `?? []`, so
 * either would work for them; "leaves a product with no attachments out of the map entirely"
 * (product-modifiers.test.ts) is what fixes which one it is.
 *
 * ONE query whatever the number of products (CLAUDE.md §3), and none at all for an empty list. The
 * tiebreak on `id` after `sort` is there so two rows a body gave the same position keep a stable
 * order between reads; nothing written through {@link writeProductModifiers} can produce that pair,
 * because it numbers the positions itself.
 */
export async function readProductModifiers(
  tx: Transaction,
  productIds: string[],
): Promise<Map<string, ProductModifierRef[]>> {
  const attachments = new Map<string, ProductModifierRef[]>();
  if (productIds.length === 0) return attachments;
  const rows = await tx
    .select({
      productId: productModifiers.productId,
      extraListId: productModifiers.extraListId,
      optionListId: productModifiers.optionListId,
    })
    .from(productModifiers)
    .where(inArray(productModifiers.productId, productIds))
    .orderBy(productModifiers.sort, productModifiers.id);
  for (const row of rows) {
    // `product_modifiers_one_reference_ck` is what makes this pair exhaustive: exactly one of the
    // two columns carries a value on every row the database holds.
    const ref: ProductModifierRef =
      row.extraListId === null
        ? { kind: "options", id: row.optionListId! }
        : { kind: "extras", id: row.extraListId };
    const held = attachments.get(row.productId) ?? [];
    held.push(ref);
    attachments.set(row.productId, held);
  }
  return attachments;
}

/** A kind-and-id pair as one key, joined by a byte no uuid can contain. */
const refKey = (ref: ProductModifierRef) => `${ref.kind}\u0000${ref.id}`;

/**
 * The list this ref names exists — `true` when the row is there, `false` when nothing holds that
 * id.
 *
 * This read used to take `for key share`, the same lock the insert in
 * {@link writeProductModifiers} takes on the row a few statements later when
 * `product_modifiers_extra_list_fk` (or its options twin) is checked, so that a concurrent delete
 * of one of these lists could not slip between the two. There is no concurrent delete: one write
 * transaction runs on the venue file at a time. `assertExtraListForWrite` (extras.ts) states the
 * mechanism and carries the receipt.
 *
 * One statement per id rather than one `in (…)`: what the loop buys is now only the ORDER the
 * refusal reports in, which {@link assertRefsExist} states. The count is the number of lists ONE
 * product attaches.
 */
async function listExists(tx: Transaction, ref: ProductModifierRef): Promise<boolean> {
  const rows =
    ref.kind === "extras"
      ? await tx.select({ id: extraLists.id }).from(extraLists).where(eq(extraLists.id, ref.id))
      : await tx.select({ id: optionLists.id }).from(optionLists).where(eq(optionLists.id, ref.id));
  return rows.length > 0;
}

/**
 * Refuses a ref naming no list, and a list named twice, as `product.invalid` carrying that ref's
 * position in the body — so the product editor can put the message beside the input it came from.
 * Left to the database, the first surfaces as a `23503` from one of the two list keys and the
 * second as a `23505` from a unique index, both driver errors carrying no field at all.
 *
 * The foreign keys and the indexes STAY: they are the database backstop under this refusal, for a
 * write that never comes through here — the same division `assertProductsExist` and
 * `extra_list_items_list_product_uq` already make in extras.ts.
 *
 * The refusal names the FIRST entry the body sent that names nothing, which is why the reads run
 * in a sorted order and the report runs in body order. A concurrent delete of one of these lists
 * used to be a real hazard here — this read took `for key share` to hold each row against one —
 * and it is not one now: one write transaction runs on the venue file at a time
 * (`assertExtraListForWrite`, extras.ts).
 *
 * What this does NOT check is the product: an unknown `productId` reaches
 * `product_modifiers_product_fk` and surfaces as a `23503` driver error. Neither caller can send
 * one: `saveProductEditor` (product-editor.ts) passes the id it just created or just locked, and
 * the product routes (`apps/server/src/catalogue-api.ts`) pass the id `createProduct` returned or
 * one `assertOwned` has already resolved, all inside the one transaction.
 */
async function assertRefsExist(tx: Transaction, refs: ProductModifierRef[]): Promise<void> {
  const seen = new Set<string>();
  for (const [at, ref] of refs.entries()) {
    if (seen.has(refKey(ref)))
      throw new AppError("product.invalid", { field: `modifiers.${at}.id` });
    seen.add(refKey(ref));
  }

  const held = new Set<string>();
  // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3). Duplicates are
  // already refused, so no pair of keys is equal and the comparator never has to say two refs are
  // the same.
  const ordered = [...refs].sort((left, right) => (refKey(left) < refKey(right) ? -1 : 1));
  for (const ref of ordered) if (await listExists(tx, ref)) held.add(refKey(ref));

  // Reported in the BODY's order, not the read order: the field a refusal names is the first entry
  // the editor sent that names nothing, whichever of them was read first.
  const at = refs.findIndex((ref) => !held.has(refKey(ref)));
  if (at !== -1) throw new AppError("product.invalid", { field: `modifiers.${at}.id` });
}

/**
 * Replaces the product's whole attachment list with `refs`, in the body's order: `sort` is the
 * position in the array, so the order an editor sent is the order {@link readProductModifiers}
 * reads back. An entry the body omits is removed, and an empty body clears the list.
 *
 * Deleting every one of the product's rows before inserting is what keeps a reordered body legal:
 * within this transaction the product starts from nothing, so no row the body keeps can collide
 * with a row it is replacing on `product_modifiers_product_extra_uq` or its options twin. The rows
 * are minted fresh each time — an attachment row's `id` is a surrogate nothing outside this file
 * holds, so losing it costs nothing. That is the first of the two conditions CLAUDE.md §3 puts on
 * this shape, and it is discharged the way conventions-data.md prescribes:
 * `grep -rn 'REFERENCES "public"."product_modifiers' --include='*.sql' packages apps` matches
 * NOTHING on 2026-09-20, so no key outside the table names a row of it, and no caller is handed
 * one either — `grep -rn "productModifiers\.id" packages apps --include="*.ts"` returns ONE line,
 * the `orderBy` tiebreak in {@link readProductModifiers} above, which never leaves this file. (The
 * dot is escaped in that command, so this comment quoting it is not itself a match.) The second
 * condition, serialising two writers, is the paragraph below.
 *
 * Every list the body names is read BEFORE the delete below, and the refusal order that produces
 * is on {@link assertRefsExist}.
 *
 * The second condition — serialising two writers — is met by the engine rather than by this file:
 * one write transaction runs on the venue file at a time, so two saves of one product cannot
 * overlap and no delete of a list can land between this body's statements.
 * `assertExtraListForWrite` (extras.ts) states the mechanism and carries the receipt.
 */
export async function writeProductModifiers(
  tx: Transaction,
  productId: string,
  refs: ProductModifierRef[],
): Promise<void> {
  const normalised = refs.map((ref) => ({ kind: ref.kind, id: normalise(ref.id) }));
  await assertRefsExist(tx, normalised);
  await tx.delete(productModifiers).where(eq(productModifiers.productId, productId));
  if (normalised.length === 0) return;
  await tx.insert(productModifiers).values(
    normalised.map((ref, sort) => ({
      id: randomUUID(),
      productId,
      sort,
      extraListId: ref.kind === "extras" ? ref.id : null,
      optionListId: ref.kind === "options" ? ref.id : null,
    })),
  );
}
