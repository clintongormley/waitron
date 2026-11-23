import { and, eq, inArray, sql } from "drizzle-orm";
import {
  lineServiceCancellations,
  products,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { AppError, checkMoves, placeInOrder, type DishMove } from "@waitron/shared";
import {
  adjustedDishIds,
  readBillSetMenus,
  readSetMenuReservations,
  setMenuDishColumns,
} from "./set-menu-bill.js";
import type { TradingContext } from "./trading-context.js";
import {
  bumpRevisionKeepingPayment,
  refuseOrderOverSimplifiedLimit,
  refusePaymentInFlight,
  totalBeforeEdit,
} from "./working-order.js";
import "./errors.js";

export async function moveSetMenuDishes(
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
  moves: readonly DishMove[],
) {
  await refusePaymentInFlight(tx, [workingOrderId]);
  const state = await readBillSetMenus(tx, workingOrderId);
  const move = checkMoves(state, moves, await readSetMenuReservations(tx, workingOrderId));
  if (move.kind === "not_placed") {
    throw new AppError("management.request_invalid", { field: "moves" });
  }
  if (move.kind === "place_taken") {
    const [line] = await tx
      .select({ name: workingOrderLines.name })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, workingOrderId),
          eq(workingOrderLines.id, move.lineId),
        ),
      );
    throw new AppError("set_menu.place_taken", { dishName: line!.name });
  }
  const before = await totalBeforeEdit(tx, cfg, workingOrderId);
  for (const result of move.results) {
    await tx
      .update(workingOrderLines)
      .set(setMenuDishColumns(result))
      .where(
        and(
          eq(workingOrderLines.workingOrderId, workingOrderId),
          eq(workingOrderLines.id, result.id),
        ),
      );
  }
  await refuseOrderOverSimplifiedLimit(tx, cfg, workingOrderId, before);
  await bumpRevisionKeepingPayment(tx, [workingOrderId]);
  return readBillSetMenus(tx, workingOrderId);
}

export async function replaceMovedDishes(
  tx: Transaction,
  workingOrderId: string,
  lineIds: readonly string[],
): Promise<void> {
  const moving = new Set(lineIds);
  const state = await readBillSetMenus(tx, workingOrderId);
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      productId: workingOrderLines.productId,
      parentProductId: products.parentId,
      cancellationLineId: lineServiceCancellations.lineId,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, workingOrderId),
        inArray(
          workingOrderLines.id,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const cancelled = lines.find((line) => line.cancellationLineId !== null);
  if (cancelled !== undefined)
    throw new AppError("set_menu.no_place_on_target", { dishName: cancelled.name });
  const reduced = await adjustedDishIds(tx, lineIds);
  const adjusted = lines.filter(({ id }) => reduced.has(id));
  if (adjusted.length > 0)
    throw new AppError("set_menu.move_adjusted", { dishNames: adjusted.map(({ name }) => name) });

  const { placed, unplaced } = placeInOrder(
    { ...state, dishes: state.dishes.filter(({ lineId }) => !moving.has(lineId)) },
    lines.map(({ id, productId, parentProductId }) => ({
      id,
      productId: parentProductId ?? productId!,
      variantId: parentProductId === null ? null : productId,
      reserved: null,
    })),
    await readSetMenuReservations(tx, workingOrderId),
  );
  if (unplaced.length > 0)
    throw new AppError("set_menu.no_place_on_target", {
      dishName: lines.find(({ id }) => id === unplaced[0])!.name,
    });
  for (const result of placed) {
    await tx
      .update(workingOrderLines)
      .set(setMenuDishColumns(result))
      .where(
        and(
          eq(workingOrderLines.workingOrderId, workingOrderId),
          eq(workingOrderLines.id, result.id),
        ),
      );
  }
}
