import { eq, isNotNull } from "drizzle-orm";
import {
  diningTables,
  floorPlanTables,
  floorPlanTableParts,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, normalisePartyName } from "@waitron/shared";
import { todayOf } from "./floor-today-table.js";
import { withMovedSlips } from "./moved-slips.js";
import type { TradingContext } from "./trading-context.js";
import "./errors.js";

export function sameName(a: string, b: string): boolean {
  return a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
}

/**
 * Today's name for the table, or for its group when it is in one; null clears it. The kitchen is
 * told of each bill of a party at those tables, and each counter order with food on its way to one
 * of them, when `kitchenToBeTold` (kitchen-print.ts) says so.
 */
export async function nameToday(
  tx: Transaction,
  cfg: TradingContext,
  tableId: string,
  name: string | null,
): Promise<void> {
  const today = await todayOf(tx, tableId);
  if (today.row.takenOff) throw new AppError("table.taken_off", { tableId });
  let wanted = normalisePartyName(name);

  if (today.merge !== null) {
    const { joinId } = today.merge;
    const [group] = await tx
      .select({ name: floorTodayJoins.name })
      .from(floorTodayJoins)
      .where(eq(floorTodayJoins.id, joinId));
    if (wanted === group!.name) return;
    if (wanted !== null) await refuseInUse(tx, wanted, { joinId });
    await withMovedSlips(
      tx,
      cfg,
      { tables: today.merge.members.map((member) => member.tableId) },
      async () => {
        await tx
          .update(floorTodayJoins)
          .set({ name: wanted })
          .where(eq(floorTodayJoins.id, joinId));
      },
    );
    return;
  }

  const [own] = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  if (wanted !== null && sameName(wanted, own!.label)) wanted = null;
  if (wanted === today.row.name) return;
  if (wanted !== null) await refuseInUse(tx, wanted, { tableId });
  await withMovedSlips(tx, cfg, { tables: [tableId] }, async () => {
    await tx
      .update(floorTodayTables)
      .set({ name: wanted })
      .where(eq(floorTodayTables.id, today.row.id));
  });
}

async function refuseInUse(
  tx: Transaction,
  name: string,
  self: { tableId: string } | { joinId: string },
): Promise<void> {
  const selfTable = "tableId" in self ? self.tableId : null;
  const selfJoin = "joinId" in self ? self.joinId : null;
  const taken = new AppError("table.label_taken", { todayName: name, field: "name" });

  const saved = await tx
    .select({ id: diningTables.id, label: diningTables.label })
    .from(diningTables);
  if (saved.some((t) => t.id !== selfTable && sameName(t.label, name))) throw taken;

  const savedGroups = await tx
    .select({ label: floorPlanTables.label, joinId: floorTodayJoinTables.joinId })
    .from(floorPlanTableParts)
    .innerJoin(floorPlanTables, eq(floorPlanTables.id, floorPlanTableParts.joinedTableId))
    .leftJoin(diningTables, eq(diningTables.planTableId, floorPlanTableParts.partTableId))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, diningTables.id));
  if (
    savedGroups.some((g) => sameName(g.label, name) && (selfJoin === null || g.joinId !== selfJoin))
  )
    throw taken;

  const todays = await tx
    .select({ tableId: floorTodayTables.tableId, name: floorTodayTables.name })
    .from(floorTodayTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayTables.tableId))
    .where(isNotNull(floorTodayTables.name));
  if (todays.some((t) => t.tableId !== selfTable && sameName(t.name!, name))) throw taken;

  const groups = await tx
    .select({ id: floorTodayJoins.id, name: floorTodayJoins.name })
    .from(floorTodayJoins)
    .where(isNotNull(floorTodayJoins.name));
  if (groups.some((g) => g.id !== selfJoin && sameName(g.name!, name))) throw taken;
}
