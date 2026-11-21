import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  diningTables,
  floorResetTables,
  ticketItems,
  workingOrders,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";

/**
 * Every order delivered to `tableId` lets go of it and keeps `label` as its table's name. The
 * caller decides the table is tied to nothing live; this only writes.
 */
export async function releaseDeliveries(
  tx: Transaction,
  tableId: string,
  label: string,
): Promise<void> {
  await tx
    .update(workingOrders)
    .set({ deliveryTableId: null, deliveryTableLabel: label })
    .where(eq(workingOrders.deliveryTableId, tableId));
}

/**
 * An order with food on its way to its delivery table: not abandoned, not collected, and holding a
 * ticket item the kitchen makes. The floor shows such a table as waiting for a delivery, and table
 * removal treats it as tied, so both read this one condition. It names `working_orders` unaliased.
 */
export function foodOnItsWay(): SQL {
  return sql`(${workingOrders.status} <> 'abandoned' and ${workingOrders.collectedAt} is null
    and exists (
      select 1 from ${ticketItems}
      join ${workingOrderLines} on ${workingOrderLines.id} = ${ticketItems.workingOrderLineId}
      where ${workingOrderLines.workingOrderId} = ${workingOrders.id} and ${ticketItems.madeHere} = 0))`;
}

/** An open delivery holds a saved group while its members would have to join. */
export function openDeliveryToJoiningGroup(): SQL {
  return sql`(${workingOrders.status} = 'open' and exists (
    select 1 from ${floorResetTables} delivery_part
    join ${floorResetTables} delivery_group on delivery_group.id = delivery_part.part_of_reset_table_id
    join ${diningTables} delivery_table on delivery_table.id = delivery_part.table_id
    where delivery_part.table_id = ${workingOrders.deliveryTableId}
      and delivery_group.pending = 1 and delivery_group.x is not null
      and (delivery_table.merge_id is null or exists (
        select 1 from ${floorResetTables} delivery_sibling
        left join ${diningTables} sibling_table on sibling_table.id = delivery_sibling.table_id
        where delivery_sibling.part_of_reset_table_id = delivery_group.id
          and sibling_table.merge_id is not delivery_table.merge_id
      ))
  ))`;
}

export async function deliveryTablesMatching(
  tx: Transaction,
  tableIds: readonly string[],
  condition: SQL,
): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ tableId: workingOrders.deliveryTableId })
    .from(workingOrders)
    .where(and(inArray(workingOrders.deliveryTableId, tableIds), condition));
  return new Set(rows.map((row) => row.tableId!));
}
