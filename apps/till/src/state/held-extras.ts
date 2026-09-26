import type { HeldExtra, OfferedModifier } from "../api/client.js";
import type { NotOfferedExtra, SelectedExtra } from "./working-order.js";

/**
 * A held order's child line names the list its pick was taken from, so each pick goes back to that
 * list when the dish's live offer still has it carrying the product. Otherwise — the list is gone
 * from the dish, no longer carries the product, or the child names no list or product — the pick goes
 * to `notOffered`. Another list offering the same product is not a substitute: it may price it
 * differently.
 *
 * The frozen `name` and `price` are kept rather than re-read from today's offer: they are what the
 * order was written at.
 */
export function deriveExtraSelections(
  offered: readonly OfferedModifier[],
  heldExtras: readonly HeldExtra[] | undefined,
): { extras: SelectedExtra[]; notOffered: NotOfferedExtra[] } {
  const extras: SelectedExtra[] = [];
  const notOffered: NotOfferedExtra[] = [];
  for (const held of heldExtras ?? []) {
    // Lower-cased, as the extras contract lower-cases an id it is sent.
    const productId = held.productId?.toLowerCase() ?? null;
    const listId = held.listId?.toLowerCase() ?? null;
    const list = offered.find(
      (entry) =>
        entry.kind === "extras" &&
        entry.id.toLowerCase() === listId &&
        entry.items.some((item) => item.productId === productId),
    );
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
