import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { extraLists, productModifiers } from "./schema/extras.js";
import { optionLists } from "./schema/options.js";
import "./errors.js";

/**
 * One entry in a product's ordered attachment list: an extras list or an options list, never both
 * (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §5). The `id` is the LIST's
 * id, not the attachment row's — the row's own key is a surrogate nothing outside this file names.
 */
export interface ProductModifierRef {
  kind: "extras" | "options";
  id: string;
}

/**
 * A uuid column compares either case in SQL and hands its value back LOWER-CASED, so an id that
 * arrives upper-cased matches its row in SQL and then matches nothing at all in a JavaScript set.
 * Every LIST id is lower-cased once here, at the boundary, and used from there on — same
 * normalisation `updateExtraList` (extras.ts) and `updateOptionList` (options.ts) apply to the id
 * their caller sends, and the two checks in {@link assertRefsExist} are what turn on it.
 *
 * The PRODUCT id is deliberately NOT normalised, because nothing here compares it in JavaScript:
 * it only ever reaches SQL, where the `uuid` column settles the case on its own. Measured rather
 * than reasoned — this file was written with the product id lower-cased in both functions and then
 * run again with that removed, and all 26 of its tests passed either way, so the call earned
 * nothing. The list ids are a different story: deleting THEIR `normalise` turns
 * "refuses a duplicate that differs only in case" and "matches a list id the caller sent in upper
 * case" (product-modifiers.test.ts) red.
 */
const normalise = (value: string) => value.toLowerCase();

/**
 * Every named product's attachment list, in `sort` order, keyed by product id.
 *
 * The keys, and every list id in the values, are the LOWER-CASED form the uuid columns hand back,
 * whatever case the caller asked in — so a caller holding an upper-cased product id has to
 * lower-case it before looking one up. Its one caller outside the tests is `readProductExtras`
 * (extra-projection.ts), which hands those keys on as its own; when Task 6 Step 4 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` wires it into the product read as
 * well, the id will have come from the database or from a contract that already lower-cases it
 * (`id` in extra-contract.ts).
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
 * AT MOST TWO grouped reads, one per kind, never one per ref (CLAUDE.md §3) — two rather than one
 * because the two kinds live in two tables, and a kind the body does not use is not read at all.
 *
 * What this does NOT check is the product: an unknown `productId` reaches
 * `product_modifiers_product_fk` and surfaces as a `23503` driver error. The plan has the
 * attachments written in the same transaction as the product row itself (Task 6 Step 4), so no
 * editor path should be able to send one — but that is a statement about a caller that does not
 * exist yet, and it is worth re-checking when one does.
 */
async function assertRefsExist(tx: Transaction, refs: ProductModifierRef[]): Promise<void> {
  const seen = new Set<string>();
  const duplicate = refs.findIndex((ref) => {
    const key = `${ref.kind}\u0000${ref.id}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (duplicate !== -1)
    throw new AppError("product.invalid", { field: `modifiers.${duplicate}.id` });

  const held = new Set<string>();
  for (const [kind, column, listTable] of [
    ["extras", extraLists.id, extraLists],
    ["options", optionLists.id, optionLists],
  ] as const) {
    const named = refs.flatMap((ref) => (ref.kind === kind ? [ref.id] : []));
    if (named.length === 0) continue;
    // Awaited in turn, never Promise.all: the two reads share one transaction (CLAUDE.md §3).
    const rows = await tx.select({ id: column }).from(listTable).where(inArray(column, named));
    for (const row of rows) held.add(`${kind}\u0000${row.id}`);
  }
  const at = refs.findIndex((ref) => !held.has(`${ref.kind}\u0000${ref.id}`));
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
 * holds, so losing it costs nothing.
 *
 * What this does NOT do is serialise two saves of the same product, and no caller supplies that
 * today either: `updateProduct` (operations.ts) takes no row lock on the product, and
 * `lockProduct` — the `select … for update` that would give one — is taken only by
 * `setProductVariants` (variants.ts:108) and `setMenuVariants` (variants.ts:189). A delete
 * cannot see another transaction's uncommitted inserts, so two overlapping saves of one product
 * can collide on `product_modifiers_product_extra_uq` or its options twin and surface as an opaque
 * `23505` — the shape measured one table over and written up on `lockExtraList` (extras.ts). Not
 * measured here, and not fixed here: whoever wires this into the product write (plan Task 6 Step 4)
 * decides whether to take the product's row lock first.
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
