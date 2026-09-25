import type { HeldExtra, OfferedModifier } from "../api/client.js";
import type { NotOfferedExtra, SelectedExtra } from "./working-order.js";

/**
 * A held order's child lines name the picked product but not the list that offered it, while the
 * wire names a list, so each pick is given the dish's first OFFERED list that carries the product.
 * Two lists offering the same product is left deliberately at "the first one wins": the server
 * cannot tell which list a stored child came off either (`docs/developers/modifiers.md`, "A picked
 * product that more than one of the dish's ACTIVE lists offers refuses the pairing"). With NO list
 * offering it the pick goes to `notOffered`, because no valid wire entry exists.
 *
 * The frozen `name` and `price` are kept rather than re-read from today's offer: they are what the
 * order was written at.
 */
export function deriveExtraSelections(
  offered: readonly OfferedModifier[],
  heldExtras: readonly HeldExtra[] | undefined,
): { extras: SelectedExtra[]; notOffered: NotOfferedExtra[] } {
  // Written only when the product is unseen: that is what makes the first offering list win.
  const listOfProduct = new Map<string, OfferedModifier>();
  for (const entry of offered) {
    if (entry.kind !== "extras") continue;
    for (const item of entry.items) {
      if (!listOfProduct.has(item.productId)) listOfProduct.set(item.productId, entry);
    }
  }
  const extras: SelectedExtra[] = [];
  const notOffered: NotOfferedExtra[] = [];
  for (const held of heldExtras ?? []) {
    // Lower-cased, as the extras and options contracts lower-case an id they are sent.
    const productId = held.productId?.toLowerCase() ?? null;
    const list = productId === null ? undefined : listOfProduct.get(productId);
    if (list === undefined || productId === null) {
      notOffered.push({
        productId: held.productId,
        name: held.name,
        price: held.price,
        quantity: held.quantity,
      });
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
  return { extras, notOffered };
}
