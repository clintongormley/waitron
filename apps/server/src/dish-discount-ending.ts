import { and, asc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  adjustmentEndingLines,
  adjustmentLines,
  adjustments,
  endAdjustment,
} from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { inIds } from "./in-ids.js";
import { endSetMenuDiscounts, setMenuDiscountsLeftBy } from "./set-menu-discount-ending.js";

/** A stored dish a basket save replaces with a new line of the same menu item at another
 * variant: the index in the save's fresh lines of the line replacing it. */
export interface VariantSwap {
  fromId: string;
  freshIndex: number;
}

/** The line a comp or discount was given on. */
const given = alias(workingOrderLines, "given");
/** The line a comp or discount took something off. */
const taken = alias(workingOrderLines, "taken");
/** The dish that line is, or is an extra of. */
const dish = alias(workingOrderLines, "dish");

/**
 * The comps and discounts that still take something off one of `dishIds` or an extra of one, given
 * on a dish row rather than on an extra, a set-menu row or the whole bill (D56): one entry for each
 * such comp or discount and dish, with every row of that dish and its extras it takes something
 * off. With the extras the edit removed from that dish, those are the only rows its ending gives
 * back, so each dish's share has an ending of its own, offered on that dish.
 */
async function ownDishDiscounts(
  tx: Transaction,
  billId: string,
  dishIds: readonly string[],
): Promise<{ adjustmentId: string; dishId: string; dishName: string; lineIds: string[] }[]> {
  if (dishIds.length === 0) return [];
  const found = await tx
    .select({
      adjustmentId: adjustments.id,
      dishId: dish.id,
      dishName: dish.name,
      lineId: taken.id,
    })
    .from(adjustmentLines)
    .innerJoin(adjustments, eq(adjustments.id, adjustmentLines.adjustmentId))
    .innerJoin(taken, eq(taken.id, adjustmentLines.lineId))
    .innerJoin(dish, eq(dish.id, sql`coalesce(${taken.parentLineId}, ${taken.id})`))
    .leftJoin(given, eq(given.id, adjustments.lineId))
    .leftJoin(adjustmentEndingLines, eq(adjustmentEndingLines.adjustmentLineId, adjustmentLines.id))
    .where(
      and(
        inIds(dish.id, dishIds),
        eq(taken.workingOrderId, billId),
        gt(adjustmentLines.reduction, 0),
        isNull(adjustmentEndingLines.id),
        ne(adjustments.action, "cancel"),
        isNotNull(adjustments.lineId),
        // A comp on an extra stands while the extra does, and goes when it is removed.
        isNull(given.parentLineId),
        sql`coalesce(${given.setMenuRole}, '') <> 'set_menu'`,
      ),
    )
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id), asc(dish.lineNo));
  const byDish = new Map<
    string,
    { adjustmentId: string; dishId: string; dishName: string; lineIds: string[] }
  >();
  for (const { lineId, ...one } of found) {
    const key = `${one.adjustmentId}:${one.dishId}`;
    const held = byDish.get(key);
    if (held === undefined) byDish.set(key, { ...one, lineIds: [lineId] });
    else held.lineIds.push(lineId);
  }
  return [...byDish.values()];
}

/**
 * Ends the own comp or discount of each dish whose extras an edit changed, `extras_changed`, offered
 * again on the dish, giving back too what it took off the extras the edit removed from that dish
 * (`removedExtrasOf`, by dish); and of each dish a basket save swaps for another variant,
 * `variant_changed`, offered again on the new line, with the own discount of any set menu a swapped
 * dish leaves (D53). Runs once the edit's lines are written and before the swapped dishes are
 * removed.
 */
export async function endRepricedDishDiscounts(
  tx: Transaction,
  billId: string,
  extrasChanged: readonly string[],
  removedExtrasOf: ReadonlyMap<string, readonly string[]>,
  swaps: readonly { fromId: string; toId: string }[],
): Promise<void> {
  for (const { adjustmentId, dishId, dishName, lineIds } of await ownDishDiscounts(
    tx,
    billId,
    extrasChanged,
  )) {
    await endAdjustment(tx, {
      adjustmentId,
      workingOrderId: billId,
      why: "extras_changed",
      dishName,
      lineId: dishId,
      lineIds,
      removedLineIds: removedExtrasOf.get(dishId) ?? [],
    });
  }
  if (swaps.length === 0) return;
  const toOf = new Map(swaps.map(({ fromId, toId }) => [fromId, toId]));
  for (const { adjustmentId, dishId, dishName, lineIds } of await ownDishDiscounts(tx, billId, [
    ...toOf.keys(),
  ])) {
    await endAdjustment(tx, {
      adjustmentId,
      workingOrderId: billId,
      why: "variant_changed",
      dishName,
      lineId: toOf.get(dishId)!,
      lineIds,
    });
  }
  const { broken, whole } = await setMenuDiscountsLeftBy(tx, billId, [...toOf.keys()]);
  await endSetMenuDiscounts(
    tx,
    billId,
    [...broken, ...whole.flatMap(({ own }) => own)],
    "variant_changed",
  );
}
