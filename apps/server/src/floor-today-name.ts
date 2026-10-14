import { and, eq, isNotNull, not } from "drizzle-orm";
import {
  diningTables,
  floorTodayJoins,
  floorTodayTables,
  floorZones,
  joinedOutOfService,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, normalisePartyName } from "@waitron/shared";
import { refuseInJoinedTable, todayOf } from "./floor-today-table.js";
import { enqueueMovedSlipsFor, readPartiesSentWork, type SentWork } from "./kitchen-print.js";
import { holdersOf } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export function sameName(a: string, b: string): boolean {
  return a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
}

/**
 * Today's name for the table, or for its group when it is in one; null clears it. The kitchen is
 * told of each bill of a party at those tables, and each counter order delivered to one of them,
 * whose place names now read differently.
 */
export async function nameToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  name: string | null,
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  if (today.row.takenOff) throw new AppError("table.taken_off", { tableId });
  await refuseInJoinedTable(tx, [tableId]);
  let wanted = normalisePartyName(name);

  if (today.merge !== null) {
    const { joinId } = today.merge;
    const [group] = await tx
      .select({ name: floorTodayJoins.name })
      .from(floorTodayJoins)
      .where(eq(floorTodayJoins.id, joinId));
    if (wanted === group!.name) return;
    if (wanted !== null) await refuseInUse(tx, cfg, wanted, { joinId });
    const before = await sentWorkAt(
      tx,
      today.merge.members.map((member) => member.tableId),
    );
    await tx.update(floorTodayJoins).set({ name: wanted }).where(eq(floorTodayJoins.id, joinId));
    await enqueueMovedSlipsFor(tx, cfg, before);
    return;
  }

  const [own] = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  if (wanted !== null && sameName(wanted, own!.label)) wanted = null;
  if (wanted === today.row.name) return;
  if (wanted !== null) await refuseInUse(tx, cfg, wanted, { tableId });
  const before = await sentWorkAt(tx, [tableId]);
  await tx
    .update(floorTodayTables)
    .set({ name: wanted })
    .where(eq(floorTodayTables.id, today.row.id));
  await enqueueMovedSlipsFor(tx, cfg, before);
}

/** The sent work of the parties at `tableIds` and of the counter orders delivered to them. */
async function sentWorkAt(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Map<string, SentWork>> {
  return readPartiesSentWork(tx, [...new Set((await holdersOf(tx, tableIds)).values())], tableIds);
}

/**
 * Any other table's saved name, any other group's today's name, and any other shown table's
 * today's name — a table the map does not draw because of a joined table is not shown. A group's
 * own members count as other tables.
 */
async function refuseInUse(
  tx: Transaction,
  cfg: TillConfig,
  name: string,
  self: { tableId: string } | { joinId: string },
): Promise<void> {
  const selfTable = "tableId" in self ? self.tableId : null;
  const selfJoin = "joinId" in self ? self.joinId : null;
  const taken = new AppError("table.label_taken", { label: name, field: "name" });

  const saved = await tx
    .select({ id: diningTables.id, label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.locationId, cfg.locationId));
  if (saved.some((t) => t.id !== selfTable && sameName(t.label, name))) throw taken;

  const todays = await tx
    .select({ tableId: floorTodayTables.tableId, name: floorTodayTables.name })
    .from(floorTodayTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayTables.tableId))
    .where(
      and(
        eq(diningTables.locationId, cfg.locationId),
        isNotNull(floorTodayTables.name),
        not(joinedOutOfService(floorTodayTables.tableId)),
      ),
    );
  if (todays.some((t) => t.tableId !== selfTable && sameName(t.name!, name))) throw taken;

  const groups = await tx
    .select({ id: floorTodayJoins.id, name: floorTodayJoins.name })
    .from(floorTodayJoins)
    .innerJoin(floorZones, eq(floorZones.id, floorTodayJoins.zoneId))
    .where(and(eq(floorZones.locationId, cfg.locationId), isNotNull(floorTodayJoins.name)));
  if (groups.some((g) => g.id !== selfJoin && sameName(g.name!, name))) throw taken;
}
