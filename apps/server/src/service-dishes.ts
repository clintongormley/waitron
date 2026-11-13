import { workingOrderLines, workingOrders, orderGroups, type Transaction } from "@waitron/db";
import { and, eq, inArray, isNull, notInArray, or, type SQL } from "drizzle-orm";
import { VENUE_SERVICE } from "./modules.js";

type Line = { id: string; parentLineId: string | null };

export async function serviceDishPredicate(tx: Transaction, lines: readonly Line[]) {
  const lunches = await VENUE_SERVICE.readLunchLineIds(tx, [
    ...new Set(lines.map((line) => line.parentLineId ?? line.id)),
  ]);
  return (line: Line): boolean =>
    line.parentLineId === null ? !lunches.has(line.id) : lunches.has(line.parentLineId);
}

export async function serviceDishCondition(tx: Transaction, scope: SQL): Promise<SQL> {
  const lines = await tx
    .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(scope);
  const lunches = [
    ...(await VENUE_SERVICE.readLunchLineIds(tx, [
      ...new Set(lines.map((line) => line.parentLineId ?? line.id)),
    ])),
  ];
  return lunches.length === 0
    ? isNull(workingOrderLines.parentLineId)
    : or(
        and(isNull(workingOrderLines.parentLineId), notInArray(workingOrderLines.id, lunches)),
        inArray(workingOrderLines.parentLineId, lunches),
      )!;
}
