import type { HeldExtra, OfferedModifier } from "../api/client.js";
import type { SelectedExtra } from "./working-order.js";

/**
 * Put a retrieved order's extras back into a re-sendable selection.
 *
 * A held order hands its extras back as VALUES — each CHILD line's picked product, its frozen name,
 * the price it was sold at and how many of it the dish takes — and a child holds no list id, because
 * an open order's child points at the product and not at the list that offered it (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4/§3.5). The wire, though, names
 * a list per answer, so an edit has to find one: the dish's OFFERED list that carries the picked
 * product. `readOfferedModifiers` (`packages/catalogue/src/offered-modifiers.ts`) hands back ACTIVE
 * lists alone, so "offered" already means active here and nothing re-checks a flag.
 *
 * TWO lists offering the same product is left deliberately at "the first one wins". The server cannot
 * tell which list a stored child came off either, so it refuses the pairing whichever of them the
 * till names, and the refusal re-prices the WHOLE order rather than the one line
 * (`apps/server/src/working-order.ts:3213`, `:3266`) — documented behaviour, not a decision this
 * function can improve
 * (`docs/developers/modifiers.md`, "A picked product that more than one of the dish's ACTIVE lists
 * offers refuses the pairing").
 *
 * NO list offering it is a different case, and there the answer is `dropped`: no valid wire entry
 * exists at all, since `validateExtraSelections` (`packages/catalogue/src/extra-contract.ts`) refuses
 * a pick naming a product the list does not carry. Sending it would fail the whole edit, so the pick
 * leaves the basket and the caller tells the operator — the same posture the app already takes for a
 * retrieved LINE whose product is gone.
 *
 * The frozen `name` and `price` are carried through rather than re-read from today's offer: they are
 * what the order was written at, and what the basket must keep showing until the server re-prices.
 */
export function deriveExtraSelections(
  offered: readonly OfferedModifier[],
  heldExtras: readonly HeldExtra[] | undefined,
): { extras: SelectedExtra[]; dropped: HeldExtra[] } {
  // Each picked product's list, resolved once for the whole line rather than re-scanned per pick.
  // Written only when the product is unseen, which is what makes "the first offering list wins"
  // above a stated rule rather than a property of whichever scan runs.
  const listOfProduct = new Map<string, OfferedModifier>();
  for (const entry of offered) {
    if (entry.kind !== "extras") continue;
    for (const item of entry.items) {
      if (!listOfProduct.has(item.productId)) listOfProduct.set(item.productId, entry);
    }
  }
  const extras: SelectedExtra[] = [];
  const dropped: HeldExtra[] = [];
  for (const held of heldExtras ?? []) {
    // Lower-cased for the reason the two contracts lower-case an answer: the stored rows come back
    // from their `uuid` columns lower-cased, so an id in any other case has to be folded first.
    const productId = held.productId?.toLowerCase() ?? null;
    const list = productId === null ? undefined : listOfProduct.get(productId);
    if (list === undefined || productId === null) {
      dropped.push(held);
      continue;
    }
    extras.push({
      listId: list.id,
      productId,
      name: held.name,
      price: held.price,
      quantity: held.quantity,
    });
  }
  return { extras, dropped };
}
