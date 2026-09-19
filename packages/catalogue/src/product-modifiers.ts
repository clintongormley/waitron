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
 * The list this ref names exists, and this transaction holds its row until it ends — `true` when
 * the row is there, `false` when nothing holds that id.
 *
 * The strength is `for key share`, which is the SAME lock the insert in
 * {@link writeProductModifiers} takes on this row a few statements later when
 * `product_modifiers_extra_list_fk` (or its options twin) is checked. Taking it here changes WHEN
 * that lock is acquired, not WHICH lock it is: before any attachment row is touched rather than
 * after. That the insert's own key check holds exactly this strength was measured on
 * PostgreSQL 18, not read off the documentation — with one session holding an open transaction
 * that had inserted a child row, a second session's `for key share` on the parent returned at
 * once and a third session's `for update` on it blocked, and the same `for update` returned at
 * once as a control once the inserter had committed. It is also shared, so two products attaching the SAME list still run side by side —
 * measured by "lets two products attach the same list at once, without either waiting for the
 * other" (product-modifiers.pg.test.ts), which stalls and fails on its own deadline when this is
 * changed to `for update`. It is not the first in this package: `assignProductUnit` (units.ts)
 * already locks a referenced row this way before writing the row that points at it — that file
 * states no reason for the strength, and nothing here rests on its choice.
 *
 * One statement per id rather than one `in (…) for update`: the order the rows are locked in is
 * the point ({@link assertRefsExist}), and a loop makes it this code's choice rather than a query
 * plan's — the reason `lockPublishedLists` (extras.ts) gives for the same shape. The count is the
 * number of lists ONE product attaches.
 */
async function lockList(tx: Transaction, ref: ProductModifierRef): Promise<boolean> {
  const rows =
    ref.kind === "extras"
      ? await tx
          .select({ id: extraLists.id })
          .from(extraLists)
          .where(eq(extraLists.id, ref.id))
          .for("key share")
      : await tx
          .select({ id: optionLists.id })
          .from(optionLists)
          .where(eq(optionLists.id, ref.id))
          .for("key share");
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
 * **The existence read is also a LOCK, and it runs before any attachment row is touched.** A save
 * that deleted the product's rows first and only then reached for a list row deadlocked against a
 * concurrent delete of one of those lists: the save held the attachment row and wanted the list
 * row for its insert's foreign key, while `deleteExtraList` (extras.ts) held the list row
 * (`lockExtraList`) and wanted that same attachment row for its cascade. Measured on real
 * PostgreSQL, before this lock existed, by
 * "saves a product's extras attachment list while one of its lists is being deleted, without
 * deadlocking" (product-modifiers.pg.test.ts): `40P01` for one of the two transactions. The
 * OPTIONS side was measured, not assumed, by the same case's second row: `deleteOptionList` takes
 * no `for update` at all, and it deadlocked just the same — its `delete from option_lists` holds
 * the list row exclusively while its cascade waits.
 *
 * LOCK ORDER, because more than one row can be locked here: every EXTRAS list first, in ascending
 * id order, then every OPTIONS list, in ascending id order — one total order over the (kind, id)
 * pairs, which is what two saves naming the same two lists in opposite body order need in order
 * not to wait on each other. The kind comes first in the key so that the extras half is exactly
 * the ascending-id order `lockPublishedLists` (extras.ts) takes, which is the only other path in
 * this package that locks more than one list row; an options list is locked by no other path
 * today. Where this sits in the order that file's `lockPublishedLists` states — menu OFFER row,
 * then `extra_lists` rows ascending, then the content-languages advisory lock — is BELOW the offer
 * row (this path never takes one) and AT the list-rows step, with the options rows appended after
 * it; this path reaches no advisory lock. That placement is traced over those two files by hand;
 * only the two-transaction race above was measured.
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
  // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3), and in turn is
  // also what makes the order above real. Duplicates are already refused, so no pair of keys is
  // equal and the comparator never has to say two refs are the same.
  const ordered = [...refs].sort((left, right) => (refKey(left) < refKey(right) ? -1 : 1));
  for (const ref of ordered) if (await lockList(tx, ref)) held.add(refKey(ref));

  // Reported in the BODY's order, not the lock order: the field a refusal names is the first entry
  // the editor sent that names nothing, whichever of them the locks reached first.
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
 * Every list the body names is locked BEFORE the delete below, which is what keeps this path from
 * deadlocking against a delete of one of those lists; the lock, its strength and its order are on
 * {@link assertRefsExist}.
 *
 * What this does NOT do is serialise two saves of the same product — a delete cannot see another
 * transaction's uncommitted inserts, so two overlapping saves could otherwise collide on
 * `product_modifiers_product_extra_uq` or its options twin and surface as an opaque `23505`, the
 * shape measured one table over and written up on `lockExtraList` (extras.ts). What stands between
 * that and a caller is the PRODUCT row: both callers write it first in the same transaction —
 * `saveProductEditor` (product-editor.ts) takes `select … for update` on an existing product, and
 * the `PATCH` route's `updateProduct` (operations.ts) issues an `UPDATE` on it — and a created
 * product is a row no second writer can have named yet. NOT MEASURED: no test races two saves of
 * one product, and PGlite cannot show one (every query serialises onto its one backend,
 * CLAUDE.md §4), so this paragraph is read off the call chain, not off a run — unlike the list
 * lock above, which is.
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
