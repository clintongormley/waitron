import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  adjustments,
  lineServiceCancellations,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { belowListPrice } from "@waitron/orders-sales/set-menu-grouping-plan.js";
import { frozenLineIdSources } from "./set-menu-freeze.js";
import "./errors.js";

/**
 * Refuses moving these set-menu dishes away from their set menu when that would unfreeze them
 * (D18): `set_menu.moves_with_set_menu` for a dish whose cancel kept its charge or whose service
 * was cancelled, and `set_menu.move_adjusted` for one a comp or discount lowered, or one held
 * itself or through an extra, as an item payment holds it (D30, D34).
 */
export async function refuseMovingFrozenDishes(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const ids = sql`(select value from json_each(${JSON.stringify(lineIds)}))`;
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      parentLineId: workingOrderLines.parentLineId,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      unitPriceGross: workingOrderLines.unitPriceGross,
      cancellationLineId: lineServiceCancellations.lineId,
      keptChargeId: adjustments.id,
    })
    .from(workingOrderLines)
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .leftJoin(
      adjustments,
      and(
        eq(adjustments.lineId, workingOrderLines.id),
        eq(adjustments.action, "cancel"),
        eq(adjustments.chargeKept, true),
      ),
    )
    .where(or(inArray(workingOrderLines.id, ids), inArray(workingOrderLines.parentLineId, ids)))
    .orderBy(workingOrderLines.lineNo);
  const dishes = rows.filter(({ parentLineId }) => parentLineId === null);
  const cancelled = dishes.find(
    ({ cancellationLineId, keptChargeId }) => cancellationLineId !== null || keptChargeId !== null,
  );
  if (cancelled !== undefined)
    throw new AppError("set_menu.moves_with_set_menu", { dishName: cancelled.name });
  const { reduced, held } = await frozenLineIdSources(
    tx,
    rows.map(({ id }) => id),
  );
  const frozen = new Set(
    rows.flatMap((row) => {
      if (held.has(row.id)) return [row.parentLineId ?? row.id];
      return reduced.has(row.id) || belowListPrice(row) ? [row.id] : [];
    }),
  );
  const adjusted = dishes.filter(({ id }) => frozen.has(id));
  if (adjusted.length > 0)
    throw new AppError("set_menu.move_adjusted", { dishNames: adjusted.map(({ name }) => name) });
}
