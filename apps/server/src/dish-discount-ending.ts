import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  adjustmentEndingLines,
  adjustmentLines,
  adjustments,
  endAdjustment,
} from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
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
 * on a dish rather than on a set-menu row or the whole bill (D56), each with the first of
 * `dishIds` it takes something off.
 */
async function ownDishDiscounts(
  tx: Transaction,
  billId: string,
  dishIds: readonly string[],
): Promise<{ adjustmentId: string; dishId: string; dishName: string }[]> {
  if (dishIds.length === 0) return [];
  const found = await tx
    .select({ adjustmentId: adjustments.id, dishId: dish.id, dishName: dish.name })
    .from(adjustmentLines)
    .innerJoin(adjustments, eq(adjustments.id, adjustmentLines.adjustmentId))
    .innerJoin(taken, eq(taken.id, adjustmentLines.lineId))
    .innerJoin(dish, eq(dish.id, sql`coalesce(${taken.parentLineId}, ${taken.id})`))
    .leftJoin(given, eq(given.id, adjustments.lineId))
    .leftJoin(adjustmentEndingLines, eq(adjustmentEndingLines.adjustmentLineId, adjustmentLines.id))
    .where(
      and(
        inArray(dish.id, sql`(select value from json_each(${JSON.stringify(dishIds)}))`),
        eq(taken.workingOrderId, billId),
        gt(adjustmentLines.reduction, 0),
        isNull(adjustmentEndingLines.id),
        ne(adjustments.action, "cancel"),
        isNotNull(adjustments.lineId),
        sql`coalesce(${given.setMenuRole}, '') <> 'set_menu'`,
      ),
    )
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id), asc(dish.lineNo));
  const seen = new Set<string>();
  return found.filter(({ adjustmentId }) => !seen.has(adjustmentId) && seen.add(adjustmentId));
}

/**
 * Ends the own comp or discount of each dish whose extras an edit changed, `extras_changed`, offered
 * again on the dish; and of each dish a basket save swaps for another variant, `variant_changed`,
 * offered again on the new line, with the own discount of any set menu a swapped dish leaves
 * (D53). Runs once the edit's lines are written and before the swapped dishes are removed.
 */
export async function endRepricedDishDiscounts(
  tx: Transaction,
  billId: string,
  extrasChanged: readonly string[],
  swaps: readonly { fromId: string; toId: string }[],
): Promise<void> {
  for (const { adjustmentId, dishId, dishName } of await ownDishDiscounts(
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
    });
  }
  if (swaps.length === 0) return;
  const toOf = new Map(swaps.map(({ fromId, toId }) => [fromId, toId]));
  for (const { adjustmentId, dishId, dishName } of await ownDishDiscounts(tx, billId, [
    ...toOf.keys(),
  ])) {
    await endAdjustment(tx, {
      adjustmentId,
      workingOrderId: billId,
      why: "variant_changed",
      dishName,
      lineId: toOf.get(dishId)!,
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
