import { and, asc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  adjustmentEndingLines,
  adjustmentLines,
  adjustments,
  endAdjustment,
  endingRestores,
  type Ending,
} from "@waitron/adjustments";
import { workingOrderLines, type AdjustmentEndingWhy, type Transaction } from "@waitron/db";
import type { AdjustmentAsk, Plan } from "./adjustments-apply.js";
import { reducedLineIds } from "./set-menu-freeze.js";

/** A set menu's own standing comp or discount, and the first of its dishes that leaves. */
export interface SetMenuDiscount {
  adjustmentId: string;
  dishName: string;
}

export interface SetMenuDiscountsLeft {
  /** The own comp or discount of each set menu that some, but not all, of its dishes leave. */
  broken: SetMenuDiscount[];
  /** Each set menu whose every dish leaves and whose row a standing comp or discount reduced, its
   * own among them or the bill's (D51), with its own standing comps or discounts. */
  whole: { setMenuLineId: string; own: SetMenuDiscount[] }[];
}

/** The line a comp or discount was given on. */
const given = alias(workingOrderLines, "given");

/**
 * The comps or discounts given on a set-menu row, wherever that row now is, that still take
 * something off one of `setMenuLineIds`: a copy made by Split after print names the row it copied,
 * so they are found by what they took off, not by the row they name.
 */
async function ownStanding(
  tx: Transaction,
  setMenuLineIds: readonly string[],
): Promise<{ adjustmentId: string; setMenuLineId: string }[]> {
  if (setMenuLineIds.length === 0) return [];
  return tx
    .selectDistinct({ adjustmentId: adjustments.id, setMenuLineId: adjustmentLines.lineId })
    .from(adjustmentLines)
    .innerJoin(adjustments, eq(adjustments.id, adjustmentLines.adjustmentId))
    .innerJoin(given, eq(given.id, adjustments.lineId))
    .leftJoin(adjustmentEndingLines, eq(adjustmentEndingLines.adjustmentLineId, adjustmentLines.id))
    .where(
      and(
        inArray(adjustmentLines.lineId, [...setMenuLineIds]),
        gt(adjustmentLines.reduction, 0),
        isNull(adjustmentEndingLines.id),
        ne(adjustments.action, "cancel"),
        eq(given.setMenuRole, "set_menu"),
      ),
    )
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
}

/** The ids of the comps or discounts given on `setMenuLineIds` that still take something off them. */
export async function ownSetMenuDiscountIds(
  tx: Transaction,
  setMenuLineIds: readonly string[],
): Promise<string[]> {
  return [
    ...new Set((await ownStanding(tx, setMenuLineIds)).map(({ adjustmentId }) => adjustmentId)),
  ];
}

/**
 * What `dishIds` leaving `billId` does to its discounted set menus, writing nothing (D48, D50,
 * D51): which set menus they break, and which they take whole.
 */
export async function setMenuDiscountsLeftBy(
  tx: Transaction,
  billId: string,
  dishIds: readonly string[],
): Promise<SetMenuDiscountsLeft> {
  if (dishIds.length === 0) return { broken: [], whole: [] };
  const placed = await tx
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      setMenuLineId: workingOrderLines.setMenuLineId,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        eq(workingOrderLines.setMenuRole, "dish"),
        isNotNull(workingOrderLines.setMenuLineId),
      ),
    )
    .orderBy(asc(workingOrderLines.lineNo), asc(workingOrderLines.id));
  const leaving = new Set(dishIds);
  const touched = new Map<string, { every: boolean; dishName: string }>();
  for (const dish of placed) {
    const menu = dish.setMenuLineId!;
    const seen = touched.get(menu);
    if (leaving.has(dish.id)) touched.set(menu, seen ?? { every: true, dishName: dish.name });
  }
  for (const dish of placed) {
    if (!leaving.has(dish.id)) {
      const seen = touched.get(dish.setMenuLineId!);
      if (seen !== undefined) seen.every = false;
    }
  }
  const menus = [...touched.keys()];
  const own = await ownStanding(tx, menus);
  const ownOf = (menu: string): SetMenuDiscount[] =>
    own
      .filter(({ setMenuLineId }) => setMenuLineId === menu)
      .map(({ adjustmentId }) => ({ adjustmentId, dishName: touched.get(menu)!.dishName }));
  const everyDish = menus.filter((menu) => touched.get(menu)!.every);
  const reduced = await reducedLineIds(tx, everyDish);
  return {
    broken: menus.filter((menu) => !touched.get(menu)!.every).flatMap(ownOf),
    whole: everyDish
      .filter((menu) => reduced.has(menu))
      .map((setMenuLineId) => ({ setMenuLineId, own: ownOf(setMenuLineId) })),
  };
}

/** Ends each of `discounts` on `billId`, `why`. */
export async function endSetMenuDiscounts(
  tx: Transaction,
  billId: string,
  discounts: readonly SetMenuDiscount[],
  why: AdjustmentEndingWhy,
): Promise<void> {
  for (const { adjustmentId, dishName } of discounts) {
    await endAdjustment(tx, { adjustmentId, workingOrderId: billId, why, dishName });
  }
}

/**
 * Ends the own comp or discount of each set menu `dishIds` take a dish from as they are removed
 * from `billId`: `dish_cancelled`, or `set_menu_cancelled` once they take its last dish (D48).
 */
export async function endDiscountsCancelledWith(
  tx: Transaction,
  billId: string,
  dishIds: readonly string[],
): Promise<void> {
  const { broken, whole } = await setMenuDiscountsLeftBy(tx, billId, dishIds);
  await endSetMenuDiscounts(tx, billId, broken, "dish_cancelled");
  await endSetMenuDiscounts(
    tx,
    billId,
    whole.flatMap(({ own }) => own),
    "set_menu_cancelled",
  );
}

type Cancelling = () => Promise<Pick<Plan, "line" | "removed" | "removedPortions">>;

/**
 * The dishes a comp-window cancel takes off whole. `plan` is asked only when a dish the cancel
 * names is in a set menu holding its own comp or discount.
 */
async function dishesCancelledBy(
  tx: Transaction,
  ask: AdjustmentAsk,
  plan: Cancelling,
): Promise<string[]> {
  if (ask.action !== "cancel" || ask.lineId === null) return [];
  const named = await setMenuDiscountsLeftBy(tx, ask.orderId, ask.lineIds ?? [ask.lineId]);
  if (named.broken.length === 0 && named.whole.every(({ own }) => own.length === 0)) return [];
  const { line, removed, removedPortions } = await plan();
  return removedPortions?.map(({ id }) => id) ?? (removed === null ? [line!.id] : []);
}

/** For a comp-window cancel, {@link endDiscountsCancelledWith} before it is planned (D48). */
export async function endDiscountsCancelledBy(
  tx: Transaction,
  ask: AdjustmentAsk,
  plan: Cancelling,
): Promise<void> {
  await endDiscountsCancelledWith(tx, ask.orderId, await dishesCancelledBy(tx, ask, plan));
}

/**
 * What a preview of a comp-window cancel works out as ended, writing nothing (D59): what
 * {@link endDiscountsCancelledBy} would end. Undefined when it ends nothing.
 */
export async function discountsCancelledBy(
  tx: Transaction,
  ask: AdjustmentAsk,
  plan: Cancelling,
): Promise<Ending | undefined> {
  const dishIds = await dishesCancelledBy(tx, ask, plan);
  const { broken, whole } = await setMenuDiscountsLeftBy(tx, ask.orderId, dishIds);
  const adjustmentIds = [...broken, ...whole.flatMap(({ own }) => own)].map(
    ({ adjustmentId }) => adjustmentId,
  );
  if (adjustmentIds.length === 0) return undefined;
  return {
    adjustmentIds,
    restores: await endingRestores(tx, { workingOrderId: ask.orderId, adjustmentIds }),
  };
}
