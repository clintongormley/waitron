import { and, eq, inArray } from "drizzle-orm";
import {
  adjustments,
  endAdjustment,
  endingRestores,
  type AdjustmentAction,
  type Ending,
} from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import type { Row } from "./adjustment-rows.js";
import type { AdjustmentAsk } from "./adjustments-apply.js";
import { money } from "./bill-allocation.js";
import { ownSetMenuDiscountIds } from "./set-menu-discount-ending.js";

/**
 * The dishes a set-menu row's comp or discount covers with it (spec section 6, D49): those placed
 * in it that are charged, which is what their supplements are; their paid extras are not covered.
 */
export function setMenuDishes(target: Row, rows: readonly Row[]): Row[] {
  if (target.setMenuRole !== "set_menu") return [];
  return rows.filter(({ setMenuLineId, unit }) => setMenuLineId === target.id && unit > 0);
}

/** A set menu's comp or discount that a new one on it replaces (D52), as a preview answers it. */
export interface Replaced {
  action: Exclude<AdjustmentAction, "cancel">;
  percentBp: number | null;
  amount: string;
}

interface Held {
  id: string;
  setMenuName: string;
  replaced: Replaced;
}

/** The comps or discounts given on the set-menu row `ask` names that still take something off it
 * or its dishes, found as {@link ownSetMenuDiscountIds} finds them. */
async function heldBySetMenu(tx: Transaction, ask: AdjustmentAsk): Promise<Held[]> {
  if (ask.action === "cancel" || ask.lineId === null) return [];
  const [setMenu] = await tx
    .select({ name: workingOrderLines.name })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.id, ask.lineId),
        eq(workingOrderLines.workingOrderId, ask.orderId),
        eq(workingOrderLines.setMenuRole, "set_menu"),
      ),
    );
  if (setMenu === undefined) return [];
  const ids = await ownSetMenuDiscountIds(tx, [ask.lineId]);
  if (ids.length === 0) return [];
  const held = await tx
    .select({
      id: adjustments.id,
      action: adjustments.action,
      percentBp: adjustments.percentBp,
      reduction: adjustments.reduction,
    })
    .from(adjustments)
    .where(inArray(adjustments.id, ids));
  return ids.map((id) => {
    const { action, percentBp, reduction } = held.find((row) => row.id === id)!;
    return {
      id,
      setMenuName: setMenu.name,
      replaced: {
        action: action as Replaced["action"],
        percentBp,
        amount: money(centsToDecimal(reduction)),
      },
    };
  });
}

/**
 * What a preview of `ask` works out as ended, writing nothing (D59): the comp or discount its
 * set-menu row holds, which the new one replaces (D52). Null when it holds none.
 */
export async function setMenuReplacement(
  tx: Transaction,
  ask: AdjustmentAsk,
): Promise<{ ending: Ending; replaces: Replaced } | null> {
  const held = await heldBySetMenu(tx, ask);
  if (held.length === 0) return null;
  const adjustmentIds = held.map(({ id }) => id);
  return {
    ending: {
      adjustmentIds,
      restores: await endingRestores(tx, { workingOrderId: ask.orderId, adjustmentIds }),
    },
    replaces: held.at(-1)!.replaced,
  };
}

/** Ends, `replaced`, the comp or discount the set-menu row `ask` names holds (D52). */
export async function endReplacedOnSetMenu(tx: Transaction, ask: AdjustmentAsk): Promise<void> {
  for (const { id, setMenuName } of await heldBySetMenu(tx, ask)) {
    await endAdjustment(tx, {
      adjustmentId: id,
      workingOrderId: ask.orderId,
      why: "replaced",
      dishName: setMenuName,
    });
  }
}
