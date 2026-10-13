import { eq } from "drizzle-orm";
import { floorTodaySplitParts, floorTodayTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { refuseInJoinedTable, todayOf } from "./floor-today-table.js";
import { placementColumns, placementOf, refuseDeliveryPending } from "./floor-today-store.js";
import { partPlaces, remainingPlace } from "./joined-split-layout.js";
import { partsOf, passGuests } from "./floor-today-parts.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/** Splits `partIds` off the joined table: they stand side by side in its place, and it keeps the rest. */
export async function splitJoinedTable(
  tx: Transaction,
  cfg: TillConfig,
  args: { tableId: string; partIds: string[]; seats: number | null },
): Promise<void> {
  const { tableId, partIds, seats } = args;
  const today = await todayOf(tx, cfg, tableId);
  const row = placementOf(today.row);
  if (row === null) throw new AppError("table.not_on_today_plan", { tableId });
  if (today.row.takenOff) throw new AppError("table.taken_off", { tableId });

  const parts = await partsOf(tx, tableId);
  if (parts.length === 0) throw new AppError("joined_table.not_found", { tableId });
  await refuseInJoinedTable(tx, [tableId]);

  const joined = new Set(parts.filter((part) => part.stillJoined).map((part) => part.tableId));
  for (const partId of partIds) {
    if (!joined.has(partId)) {
      throw new AppError("joined_table.part_invalid", { tableId: partId, field: "partIds" });
    }
  }
  const named = new Set(partIds);
  const left = [...joined].filter((partId) => !named.has(partId));
  if (left.length === 0) {
    throw new AppError("joined_table.split_all", { tableId, field: "partIds" });
  }
  if (left.length >= 2 && seats === null) throw new AppError("joined_table.seats_required", {});
  const toOne = left.length === 1;
  if (toOne) await refuseDeliveryPending(tx, tableId);

  const splitting = toOne ? joined : named;
  const covered = parts.findIndex((part) => !part.splitOff);
  const places = partPlaces(row, parts, covered);
  for (const [index, part] of parts.entries()) {
    if (!splitting.has(part.tableId)) continue;
    await tx
      .insert(floorTodaySplitParts)
      .values({ joinedTableId: tableId, partTableId: part.tableId });
    await tx
      .update(floorTodayTables)
      .set({ ...placementColumns(places[index]!), takenOff: false })
      .where(eq(floorTodayTables.tableId, part.tableId));
  }
  if (toOne) {
    await passGuests(tx, cfg, tableId, [left[0]!], "now");
    return;
  }

  const standing = parts.flatMap((part, index) =>
    part.splitOff || splitting.has(part.tableId) ? [] : [index],
  );
  const place = remainingPlace(row, parts, covered, standing[0]!, standing.at(-1)!);
  await tx
    .update(floorTodayTables)
    .set({ ...placementColumns(place), seats })
    .where(eq(floorTodayTables.id, today.row.id));
}
