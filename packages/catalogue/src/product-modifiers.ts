import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { extraLists, productModifiers } from "./schema/extras.js";
import { optionLists } from "./schema/options.js";
import type { ProductModifierRef } from "./product-types.js";
import "./errors.js";

export type { ProductModifierRef } from "./product-types.js";

/**
 * The two kinds of list a product's attachment list can name. Both body parsers decide what to
 * refuse from it, so a third kind is added here and nowhere else.
 *
 * The `satisfies` ties this to {@link ProductModifierRef} in ONE direction only: a kind added to the
 * TYPE and not here compiles fine, and is then refused by both parsers.
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
 * An id may arrive in either case, and an id column compares byte for byte
 * (packages/shared/src/ids.ts), so every id this file writes or looks up passes through here.
 */
const normalise = (value: string) => value.toLowerCase();

/**
 * Every named product's attachment list, in `sort` order, keyed by product id. The keys, and every
 * list id in the values, are LOWER-CASED whatever case the caller asked in. A product with NO
 * attachments has no entry at all — not an empty array.
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
    .where(inArray(productModifiers.productId, productIds.map(normalise)))
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
 * The foreign keys and unique indexes stay as the database backstop for a write that never comes
 * through here.
 *
 * What this does NOT check is the product: an unknown `productId` reaches
 * `product_modifiers_product_fk` as a driver error. Every caller passes an id it created or has
 * already found: `saveProductEditor` (product-editor.ts), the product routes
 * (`apps/server/src/catalogue-api.ts`, the id `createProduct` returned or one `assertOwned`
 * resolved) and the demo seed (the ids `seedCatalogues` created).
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
  // already refused, so the comparator never has to say two refs are equal.
  const ordered = [...refs].sort((left, right) => (refKey(left) < refKey(right) ? -1 : 1));
  for (const ref of ordered) if (await listExists(tx, ref)) held.add(refKey(ref));

  // Reported in the BODY's order, not the read order: the field a refusal names is the first entry
  // the editor sent that names nothing, whichever of them was read first.
  const at = refs.findIndex((ref) => !held.has(refKey(ref)));
  if (at !== -1) throw new AppError("product.invalid", { field: `modifiers.${at}.id` });
}

/**
 * Replaces the product's whole attachment list with `refs`, in the body's order: `sort` is the
 * position in the array. An entry the body omits is removed, and an empty body clears the list.
 *
 * Delete-then-insert keeps a reordered body clear of `product_modifiers_product_extra_uq` and its
 * options twin. The rows are minted fresh each time: no foreign key in any migration references
 * `product_modifiers`, and `productModifiers.id` is read only by the tiebreak in
 * {@link readProductModifiers}. Two writers are serialised by `withTransaction`, which admits one
 * write transaction per venue file (CLAUDE.md §3).
 */
export async function writeProductModifiers(
  tx: Transaction,
  productId: string,
  refs: ProductModifierRef[],
): Promise<void> {
  const product = normalise(productId);
  const normalised = refs.map((ref) => ({ kind: ref.kind, id: normalise(ref.id) }));
  await assertRefsExist(tx, normalised);
  await tx.delete(productModifiers).where(eq(productModifiers.productId, product));
  if (normalised.length === 0) return;
  await tx.insert(productModifiers).values(
    normalised.map((ref, sort) => ({
      id: randomUUID(),
      productId: product,
      sort,
      extraListId: ref.kind === "extras" ? ref.id : null,
      optionListId: ref.kind === "options" ? ref.id : null,
    })),
  );
}
