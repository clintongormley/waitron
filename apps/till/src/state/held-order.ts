import type { HeldOrder } from "../api/orders-api.js";
import type { TillProduct } from "../api/menu-api.js";
import type { StringKey } from "../i18n/strings.js";
import type { StoredLines } from "../widgets/basket.js";
import { deriveExtraSelections } from "./held-extras.js";
import { deriveOptionSelections } from "./held-options.js";
import { setMenuDish } from "./menu-refresh.js";
import { displayQuantity, offeredListsOf } from "./order-line.js";
import type { SetMenuOfferLookup } from "./set-menus.js";
import type { OrderLine } from "./working-order.js";

/** `order`'s lines rebuilt against `offered`, and the one banner that says what the rebuild
 * changed. */
export function basketLinesOf(
  order: HeldOrder,
  listed: StoredLines | null,
  offered: readonly TillProduct[],
  setMenuOffer: SetMenuOfferLookup,
): { lines: OrderLine[]; banner?: StringKey } {
  const lines: OrderLine[] = [];
  let droppedAProduct = false;
  let extraNotOffered = false;
  let mustChooseAgain = false;
  let mustChooseOnWithdrawnDish = false;
  const liveByMenuItem = new Map<string, TillProduct>();
  for (const candidate of offered) {
    if (candidate.menuItemId !== undefined && !liveByMenuItem.has(candidate.menuItemId))
      liveByMenuItem.set(candidate.menuItemId, candidate);
  }
  const sentLines = new Set(
    (listed?.lines ?? [])
      .filter((row) => row.sentAt !== null || row.firedAt !== null)
      .map((row) => row.id),
  );
  for (const line of order.lines) {
    // Edits to a set-menu dish answer the recorded offer's lists, even after a republish.
    const recorded =
      line.setMenuId === undefined
        ? undefined
        : setMenuOffer({
            setMenuId: line.setMenuId,
            menuItemId: line.menuItemId ?? "",
            menuVersionId: line.menuVersionId ?? null,
            ...(line.product?.menuId === undefined ? {} : { menuId: line.product.menuId }),
          });
    const live =
      line.setMenuId !== undefined
        ? recorded && setMenuDish(recorded, line.menuVersionId ?? null)
        : line.menuItemId === undefined
          ? undefined
          : liveByMenuItem.get(line.menuItemId);
    const stored = line.product;
    const product =
      stored === undefined
        ? live
        : {
            ...stored,
            ...(recorded === undefined ? {} : { unit: recorded.offer.unit }),
            ...(line.menuVersionId === undefined ? {} : { menuVersionId: line.menuVersionId }),
            ...(live === undefined ? {} : { offeredModifiers: offeredListsOf(live) }),
          };
    if (product === undefined) {
      droppedAProduct = true;
      continue;
    }
    // Each pick goes back to the list it was taken from, if the live offer still has it there.
    const picks = deriveExtraSelections(product.offeredModifiers ?? [], line.extras);
    if (picks.notOffered.length > 0) extraNotOffered = true;
    const answers = deriveOptionSelections(product.offeredModifiers ?? [], line.optionSnapshots);
    const sent = line.workingOrderLineId !== undefined && sentLines.has(line.workingOrderLineId);
    if (answers.unanswered.length > 0 && !sent) {
      mustChooseAgain = true;
      if (live === undefined && line.setMenuId === undefined) mustChooseOnWithdrawnDish = true;
    }
    lines.push({
      product,
      ...(line.setMenuId === undefined ? {} : { setMenuId: line.setMenuId }),
      quantity: displayQuantity(product, line.quantity),
      ...(line.workingOrderLineId === undefined
        ? {}
        : { workingOrderLineId: line.workingOrderLineId }),
      ...(live === undefined ? { notOffered: true as const } : {}),
      ...(picks.extras.length === 0 ? {} : { extras: picks.extras }),
      ...(picks.notOffered.length === 0 ? {} : { notOfferedExtras: picks.notOffered }),
      ...(answers.options.length === 0 ? {} : { options: answers.options }),
      ...(line.optionSnapshots === undefined ? {} : { optionSnapshots: line.optionSnapshots }),
      ...(line.note === undefined ? {} : { note: line.note }),
      ...(line.makeAt == null ? {} : { makeAt: line.makeAt }),
    });
  }
  // One banner, so a DROPPED product is reported first: it has already changed what the basket
  // will bill, where the others change nothing until the operator edits the order. Without the
  // stored lines the till cannot tell a sent line from one not sent, and choosing again on a sent
  // dish would recall it or be refused, so the operator is asked to read the order again first.
  const banner: StringKey | undefined = droppedAProduct
    ? "held.product_gone"
    : mustChooseAgain && listed === null
      ? "held.reread_failed"
      : mustChooseOnWithdrawnDish
        ? "held.options_changed"
        : extraNotOffered
          ? "held.extra_not_offered"
          : mustChooseAgain
            ? "held.options_changed"
            : undefined;
  return banner === undefined ? { lines } : { lines, banner };
}
