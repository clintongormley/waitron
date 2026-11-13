import { and, eq, inArray, or } from "drizzle-orm";
import {
  diningTables,
  floorZones,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  tableMerges,
  floorTodayJoinTables,
  parties,
  partyTables,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { FloorDeletion, TableRemoval } from "@waitron/module";
import {
  AppError,
  type DeleteImpactItem,
  type DeleteImpactRefusal,
  type DeleteTarget,
  type ErrorCode,
  type ErrorParams,
} from "@waitron/shared";
import { foodOnItsWay } from "./delivery-release.js";
import { deletePlans, removeSets } from "./floor-plan-sets.js";
import { removeLiveTables, tableDeleteRefusals } from "./table-removal.js";
import "./errors.js";

function sorted(targets: DeleteTarget[]): DeleteTarget[] {
  return targets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function labelled(rows: { id: string; label: string }[]): DeleteTarget[] {
  return sorted(rows.map((row) => ({ id: row.id, name: row.label })));
}
function joins(
  parents: { id: string }[],
  members: { joinId: string; id: string; label: string }[],
): DeleteTarget[] {
  return sorted(
    parents.map((parent) => ({
      id: parent.id,
      name: labelled(members.filter((member) => member.joinId === parent.id))
        .map((target) => target.name)
        .join(", "),
    })),
  );
}
async function inventory(tx: Transaction, zoneIds: readonly string[]) {
  const zones = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(inArray(floorZones.id, [...zoneIds]));
  const ids = zones.map((zone) => zone.id);
  const tables = await tx.select().from(diningTables).where(inArray(diningTables.zoneId, ids));
  tables.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const plans = await tx.select().from(floorPlans).where(inArray(floorPlans.zoneId, ids));
  const saved = await tx.select().from(floorPlanTables).where(inArray(floorPlanTables.zoneId, ids));
  const todayJoins = await tx
    .select()
    .from(tableMerges)
    .where(inArray(tableMerges.zoneId, ids));
  const todayMembers = await tx
    .select({ joinId: floorTodayJoinTables.joinId, id: diningTables.id, label: diningTables.label })
    .from(floorTodayJoinTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayJoinTables.tableId))
    .where(
      inArray(
        floorTodayJoinTables.joinId,
        todayJoins.map((join) => join.id),
      ),
    );
  const reset = await tx
    .select()
    .from(floorResetTables)
    .where(inArray(floorResetTables.zoneId, ids));
  const removes: DeleteImpactItem[] = [
    { key: "tables", count: tables.length, targets: labelled(tables) },
    { key: "saved_tables", count: saved.length, targets: labelled(saved) },
    { key: "today_joins", count: todayJoins.length, targets: joins(todayJoins, todayMembers) },
    { key: "reset_targets", count: reset.length, targets: labelled(reset) },
  ].filter((item) => item.count > 0);
  return { ids, tables, plans, saved, todayJoins, removes };
}
async function refusalsFor(
  tx: Transaction,
  removals: readonly TableRemoval[],
  tables: (typeof diningTables.$inferSelect)[],
  now: Date,
) {
  const ids = tables.map((table) => table.id);
  const held = await tx
    .selectDistinct({ tableId: partyTables.tableId, id: parties.id, name: parties.name })
    .from(partyTables)
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .where(and(inArray(partyTables.tableId, ids), eq(parties.state, "open")));
  const delivered = await tx
    .select({
      tableId: workingOrders.deliveryTableId,
      id: workingOrders.id,
      label: workingOrders.label,
      number: workingOrders.orderNumber,
    })
    .from(workingOrders)
    .where(
      and(
        inArray(workingOrders.deliveryTableId, ids),
        or(inArray(workingOrders.status, ["open", "placed"]), foodOnItsWay()),
      ),
    );
  const refusals: DeleteImpactRefusal[] = [];
  for (const table of tables) {
    for (const target of sorted(
      held
        .filter((row) => row.tableId === table.id)
        .map((row) => ({ id: row.id, name: row.name ?? table.label })),
    )) {
      refusals.push({
        code: "zone.table_in_use",
        params: { zoneId: table.zoneId, tableId: table.id, tableName: table.label },
        targets: [target],
      });
    }
    for (const target of sorted(
      delivered
        .filter((row) => row.tableId === table.id)
        .map((row) => ({ id: row.id, name: row.label ?? String(row.number) })),
    )) {
      refusals.push({
        code: "table.delivery_in_progress",
        params: { tableId: table.id, workingOrderId: target.id },
        targets: [target],
      });
    }
  }
  refusals.push(...(await tableDeleteRefusals(tx, removals, ids, now)));
  return refusals;
}
export function floorDeletionFor(removals: readonly TableRemoval[]): FloorDeletion {
  return {
    removeSets,
    async readImpact(tx, zoneIds, now) {
      const floor = await inventory(tx, zoneIds);
      return {
        refusals: await refusalsFor(tx, removals, floor.tables, now),
        removes: floor.removes,
      };
    },
    async clear(tx, zoneIds, now) {
      const floor = await inventory(tx, zoneIds);
      const [refusal] = await refusalsFor(tx, removals, floor.tables, now);
      if (refusal)
        throw new AppError(refusal.code as ErrorCode, refusal.params as ErrorParams[ErrorCode]);
      await tx.delete(floorResetTables).where(inArray(floorResetTables.zoneId, floor.ids));
      const kept = await removeLiveTables(
        tx,
        removals,
        floor.tables.map((table) => table.id),
        now,
      );
      // removeLiveTables can have released earlier rows before discovering an unknown reference.
      // Throwing here lets the caller's transaction undo the complete hierarchy cleanup.
      const retained = floor.tables.find((table) => kept.has(table.id));
      if (retained)
        throw new AppError("zone.table_in_use", {
          zoneId: retained.zoneId,
          tableId: retained.id,
          tableName: retained.label,
        });
      const todayJoinIds = floor.todayJoins.map((join) => join.id);
      await tx
        .delete(floorTodayJoinTables)
        .where(inArray(floorTodayJoinTables.joinId, todayJoinIds));
      await tx.delete(tableMerges).where(inArray(tableMerges.id, todayJoinIds));
      await tx
        .update(floorZones)
        .set({
          todayBusinessDay: null,
          todayRevision: 0,
          todaySetId: null,
          todayLayoutRevision: 0,
          todayOccurrence: null,
        })
        .where(inArray(floorZones.id, floor.ids));
      const masterIds = floor.saved.map((table) => table.id);
      await tx
        .update(diningTables)
        .set({ planTableId: null })
        .where(inArray(diningTables.planTableId, masterIds));
      await tx
        .update(floorResetTables)
        .set({ planTableId: null })
        .where(inArray(floorResetTables.planTableId, masterIds));
      await tx
        .update(floorPlanTables)
        .set({ partOfTableId: null })
        .where(inArray(floorPlanTables.partOfTableId, masterIds));
      await deletePlans(
        tx,
        floor.plans.map((plan) => plan.id),
      );
      await tx.delete(floorPlanTables).where(inArray(floorPlanTables.id, masterIds));
    },
  };
}
