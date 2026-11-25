import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  adjustments,
  lineServiceCancellations,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { namedFrozenLineIds } from "./set-menu-freeze.js";
import "./errors.js";

/**
 * Refuses moving these set-menu dishes away from their set menu when that would unfreeze them
 * (D18): `set_menu.no_place_on_target` for a dish whose cancel kept its charge, and
 * `set_menu.move_adjusted` for one frozen by its own comp or discount, or an extra's, or a stamped
 * list price (D15).
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
    throw new AppError("set_menu.no_place_on_target", { dishName: cancelled.name });
  const named = await namedFrozenLineIds(
    tx,
    rows.map(({ id }) => id),
  );
  const frozen = new Set(
    rows.flatMap(({ id, parentLineId, listUnitPriceGross }) =>
      named.has(id) || listUnitPriceGross !== null ? [parentLineId ?? id] : [],
    ),
  );
  const adjusted = dishes.filter(({ id }) => frozen.has(id));
  if (adjusted.length > 0)
    throw new AppError("set_menu.move_adjusted", { dishNames: adjusted.map(({ name }) => name) });
}
