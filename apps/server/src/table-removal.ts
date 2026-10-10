import { and, eq, exists, inArray, isNull, ne, or } from "drizzle-orm";
import {
  diningTables,
  floorResetTables,
  floorTodayTables,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  parties,
  partyTables,
  ticketItems,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { releaseDeliveries } from "./delivery-release.js";
import { leaveMerges } from "./floor-today-merges.js";
import type { TillConfig } from "./till-config.js";

/** An open party holds the table or used it earlier in its meal, or an order to it is unpaid or has food on its way. */
export async function tableTied(tx: Transaction, tableId: string): Promise<boolean> {
  const [party] = await tx
    .select({ id: partyTables.id })
    .from(partyTables)
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .where(and(eq(partyTables.tableId, tableId), eq(parties.state, "open")))
    .limit(1);
  if (party !== undefined) return true;
  // The floor's pending-delivery test (`listTablesWithState`), or an order not yet paid.
  const [order] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(
      and(
        eq(workingOrders.deliveryTableId, tableId),
        or(
          inArray(workingOrders.status, ["open", "placed"]),
          and(
            ne(workingOrders.status, "abandoned"),
            isNull(workingOrders.collectedAt),
            exists(
              tx
                .select({ id: ticketItems.id })
                .from(ticketItems)
                .where(
                  and(
                    eq(ticketItems.workingOrderId, workingOrders.id),
                    eq(ticketItems.madeHere, false),
                  ),
                ),
            ),
          ),
        ),
      ),
    )
    .limit(1);
  return order !== undefined;
}

/** Whether any module refuses to let go of the table; a failure that is not an AppError is rethrown. */
export async function refusedByAModule(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<boolean> {
  for (const removal of removals) {
    try {
      await removal.refuse(tx, { locationId: cfg.locationId }, tableId, now);
    } catch (error) {
      if (error instanceof AppError) return true;
      throw error;
    }
  }
  return false;
}

/**
 * Removes the live table for good. Returns false when a module refuses, having changed nothing, or
 * when something unknown still names it, having kept its reset row and the table itself.
 */
export async function removeLiveTable(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<boolean> {
  if (await refusedByAModule(tx, cfg, removals, tableId, now)) return false;
  const { locationId } = cfg;
  const [table] = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  const { label } = table!;
  for (const removal of removals) await removal.release(tx, { locationId }, tableId, label);
  await releaseDeliveries(tx, tableId, label);
  await leaveMerges(tx, [tableId]);
  await tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId));
  const resetRows = await tx
    .delete(floorResetTables)
    .where(eq(floorResetTables.tableId, tableId))
    .returning();
  try {
    await tx.delete(diningTables).where(eq(diningTables.id, tableId));
  } catch (error) {
    if (!isRefusal(error, FOREIGN_KEY_VIOLATION)) throw error;
    // A refused statement backs out only itself, so the reset row goes back for the next catch-up.
    if (resetRows.length > 0) await tx.insert(floorResetTables).values(resetRows);
    return false;
  }
  return true;
}
