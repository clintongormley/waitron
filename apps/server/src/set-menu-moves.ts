import { and, eq } from "drizzle-orm";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { AppError, checkMoves, type DishMove } from "@waitron/shared";
import { readBillSetMenus, readSetMenuReservations, setMenuDishColumns } from "./set-menu-bill.js";
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
