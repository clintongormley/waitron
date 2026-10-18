import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  diningTables,
  floorResetTableParts,
  floorResetTables,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  joinedOutOfService,
  needsMoving,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { standsIn } from "./joined-split-layout.js";
import { catchUpZone, placementOf, refuseDeliveryPending } from "./floor-today-store.js";
import { refuseUnfree, zoneOfTable } from "./floor-today-table.js";
import { refusedByAModule } from "./table-removal.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

const joinedRow = alias(floorResetTables, "mark_moved_joined");

/** Whether the till shows the table "Needs moving". */
export async function tableNeedsMoving(tx: Transaction, tableId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), needsMoving(diningTables.id)));
  return row !== undefined;
}

/**
 * Applies the change of a table that needs moving, with every row of a pending joined group
 * holding it (plan decision 8), and clears their marks. Refused `table.new_place_taken` while a
 * drawn table outside the group that does not itself need moving stands in one of the group's new
 * places. A table that does not need moving is left as it is (plan decision 11).
 */
export async function markMoved(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<void> {
  const zoneId = await zoneOfTable(tx, cfg, tableId);
  if (!(await tableNeedsMoving(tx, tableId))) return;
  const [own] = await tx
    .select({ id: floorResetTables.id })
    .from(floorResetTables)
    .where(and(eq(floorResetTables.tableId, tableId), eq(floorResetTables.pending, true)));
  const links = await tx
    .select({ joinedId: floorResetTableParts.joinedResetTableId })
    .from(floorResetTableParts)
    .innerJoin(
      joinedRow,
      and(eq(joinedRow.id, floorResetTableParts.joinedResetTableId), eq(joinedRow.pending, true)),
    )
    .where(
      or(
        eq(floorResetTableParts.joinedResetTableId, own!.id),
        eq(floorResetTableParts.partResetTableId, own!.id),
      ),
    );
  const joinedIds = [...new Set(links.map((link) => link.joinedId))];
  const parts =
    joinedIds.length === 0
      ? []
      : await tx
          .select({ id: floorResetTableParts.partResetTableId })
          .from(floorResetTableParts)
          .where(inArray(floorResetTableParts.joinedResetTableId, joinedIds));
  const groupIds = new Set([own!.id, ...joinedIds, ...parts.map((part) => part.id)]);
  const group = await tx
    .select({
      row: floorResetTables,
      todayTakenOff: floorTodayTables.takenOff,
    })
    .from(floorResetTables)
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, floorResetTables.tableId))
    .where(and(inArray(floorResetTables.id, [...groupIds]), eq(floorResetTables.pending, true)));
  const groupTables = new Set(
    group.flatMap(({ row }) => (row.tableId === null ? [] : [row.tableId])),
  );

  const drawn = await tx
    .select({ today: floorTodayTables })
    .from(floorTodayTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayTables.tableId))
    .where(
      and(
        eq(diningTables.zoneId, zoneId),
        isNotNull(floorTodayTables.x),
        eq(floorTodayTables.takenOff, false),
      ),
    );
  const others = drawn.filter(({ today }) => !groupTables.has(today.tableId));
  const exempt = new Set(
    others.length === 0
      ? []
      : (
          await tx
            .select({ id: diningTables.id })
            .from(diningTables)
            .where(
              and(
                inArray(
                  diningTables.id,
                  others.map(({ today }) => today.tableId),
                ),
                or(needsMoving(diningTables.id), joinedOutOfService(diningTables.id)),
              ),
            )
        ).map((row) => row.id),
  );
  const standing = others.filter(({ today }) => !exempt.has(today.tableId));
  for (const { row, todayTakenOff } of group) {
    const place = placementOf(row);
    // A marked table taken off goes to its new place still off, so stands in nothing.
    if (row.placed || place === null || todayTakenOff === true) continue;
    const blocker = standing.find(({ today }) => standsIn(place, placementOf(today)!));
    if (blocker !== undefined) {
      throw new AppError("table.new_place_taken", {
        tableId: row.tableId ?? tableId,
        standingId: blocker.today.tableId,
      });
    }
  }

  await catchUpZone(tx, cfg, removals, zoneId, now, {
    inReset: false,
    keepTakenOff: false,
    carry: new Set(group.map(({ row }) => row.id)),
  });
  if (await tableNeedsMoving(tx, tableId))
    await refuseHeldBack(tx, cfg, removals, now, tableId, [...groupTables]);
}

/**
 * Throws what still holds back the group of `tables`, which Mark moved could not apply: food on
 * its way, a party, a table needing clearing or a module's refusal to let a table go, at one of
 * them or at a table tied to them by today's merges and splits, as the catch-up's waiting rules
 * tie them. `table.needs_moving` is the answer when none of those is found.
 */
async function refuseHeldBack(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
  tableId: string,
  tables: readonly string[],
): Promise<never> {
  const tied = new Set(tables);
  for (let size = 0; size !== tied.size;) {
    size = tied.size;
    const ids = [...tied];
    const joins = tx
      .select({ id: floorTodayJoinTables.joinId })
      .from(floorTodayJoinTables)
      .where(inArray(floorTodayJoinTables.tableId, ids));
    const merged = await tx
      .select({ id: floorTodayJoinTables.tableId })
      .from(floorTodayJoinTables)
      .where(inArray(floorTodayJoinTables.joinId, joins));
    const split = await tx
      .select({
        part: floorTodaySplitParts.partTableId,
        joined: floorTodaySplitParts.joinedTableId,
      })
      .from(floorTodaySplitParts)
      .where(
        or(
          inArray(floorTodaySplitParts.partTableId, ids),
          inArray(floorTodaySplitParts.joinedTableId, ids),
        ),
      );
    for (const row of merged) tied.add(row.id);
    for (const row of split) {
      tied.add(row.part);
      tied.add(row.joined);
    }
  }
  const ids = [tableId, ...[...tied].filter((id) => id !== tableId)];
  for (const id of ids) await refuseDeliveryPending(tx, id);
  await refuseUnfree(tx, ids);
  const removing = await tx
    .select({ id: floorResetTables.tableId })
    .from(floorResetTables)
    .where(
      and(
        inArray(floorResetTables.tableId, ids),
        eq(floorResetTables.pending, true),
        eq(floorResetTables.remove, true),
      ),
    );
  const refusals = await refusedByAModule(
    tx,
    cfg,
    removals,
    removing.map((row) => row.id!),
    now,
  );
  for (const id of ids) {
    const refusal = refusals.get(id);
    if (refusal !== undefined) throw refusal;
  }
  throw new AppError("table.needs_moving", { tableId });
}
