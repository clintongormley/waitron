import { and, eq, inArray, or } from "drizzle-orm";
import {
  diningTables,
  floorResetTables,
  floorTodayTables,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  parties,
  partyTables,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import type { AppError } from "@waitron/shared";
import { foodOnItsWay, releaseDeliveries } from "./delivery-release.js";
import { leaveMerges } from "./floor-today-merges.js";
import type { TillConfig } from "./till-config.js";

/** Those of `tableIds` an open party holds or used earlier in its meal, or that an unpaid order, or one with food on its way, is delivered to. */
export async function tablesTied(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set();
  const ids = [...tableIds];
  const parted = await tx
    .selectDistinct({ tableId: partyTables.tableId })
    .from(partyTables)
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .where(and(inArray(partyTables.tableId, ids), eq(parties.state, "open")));
  const tied = new Set(parted.map((row) => row.tableId));
  const rest = ids.filter((id) => !tied.has(id));
  if (rest.length === 0) return tied;
  const ordered = await tx
    .selectDistinct({ tableId: workingOrders.deliveryTableId })
    .from(workingOrders)
    .where(
      and(
        inArray(workingOrders.deliveryTableId, rest),
        or(inArray(workingOrders.status, ["open", "placed"]), foodOnItsWay()),
      ),
    );
  for (const row of ordered) tied.add(row.tableId!);
  return tied;
}

/** Each of `tableIds` some module refuses to let go of, with the first module's refusal. */
export async function refusedByAModule(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  removals: readonly TableRemoval[],
  tableIds: readonly string[],
  now: Date,
): Promise<Map<string, AppError>> {
  const refused = new Map<string, AppError>();
  if (tableIds.length === 0) return refused;
  for (const removal of removals) {
    const refusals = await removal.refuse(tx, { locationId: cfg.locationId }, tableIds, now);
    for (const id of tableIds) {
      const refusal = refusals.get(id);
      if (refusal !== undefined && !refused.has(id)) refused.set(id, refusal);
    }
  }
  return refused;
}

/**
 * Removes the live tables for good, returning those it kept: each a module refuses, having changed
 * nothing, and each something unknown still names, having kept its reset row and the table itself.
 */
export async function removeLiveTables(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  removals: readonly TableRemoval[],
  tableIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  const kept = new Set((await refusedByAModule(tx, cfg, removals, tableIds, now)).keys());
  const rest = tableIds.filter((id) => !kept.has(id));
  if (rest.length === 0) return kept;
  const { locationId } = cfg;
  const labels = new Map(
    (
      await tx
        .select({ id: diningTables.id, label: diningTables.label })
        .from(diningTables)
        .where(inArray(diningTables.id, rest))
    ).map((row) => [row.id, row.label]),
  );
  for (const tableId of rest) {
    const label = labels.get(tableId)!;
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
      kept.add(tableId);
    }
  }
  return kept;
}
