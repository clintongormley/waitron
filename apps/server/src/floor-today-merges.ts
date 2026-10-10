import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { floorTodayJoins, floorTodayJoinTables, floorTodayTables } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/**
 * The tables leave their today's merges; a merge left with fewer than two members goes, and its last
 * member goes back to where it stood before the merge.
 */
export async function leaveMerges(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  const left = await tx
    .delete(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...tableIds]))
    .returning({ joinId: floorTodayJoinTables.joinId });
  for (const joinId of new Set(left.map((row) => row.joinId))) {
    const rest = await tx
      .select({
        tableId: floorTodayJoinTables.tableId,
        beforeX: floorTodayJoinTables.beforeX,
        beforeY: floorTodayJoinTables.beforeY,
        beforeRotation: floorTodayJoinTables.beforeRotation,
      })
      .from(floorTodayJoinTables)
      .where(eq(floorTodayJoinTables.joinId, joinId));
    if (rest.length >= 2) continue;
    for (const member of rest) {
      await tx
        .update(floorTodayTables)
        .set({ x: member.beforeX, y: member.beforeY, rotation: member.beforeRotation })
        .where(and(eq(floorTodayTables.tableId, member.tableId), isNotNull(floorTodayTables.x)));
    }
    await tx.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, joinId));
    await tx.delete(floorTodayJoins).where(eq(floorTodayJoins.id, joinId));
  }
}
