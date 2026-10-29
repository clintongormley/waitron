import { eq } from "drizzle-orm";
import {
  diningTables,
  floorTodayTables,
  newId,
  shortNameColumns,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { TradingContext } from "../trading-context.js";

export async function createTable(
  tx: Transaction,
  cfg: TradingContext,
  input: { label: string; zoneId: string; shortName?: string },
  options: { today?: boolean } = {},
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(diningTables)
    .values({
      id: newId(),
      locationId: cfg.locationId,
      label: input.label,
      zoneId: input.zoneId,
      ...shortNameColumns(input.shortName ?? null),
    })
    .returning({ id: diningTables.id });
  if (options.today !== false) await tx.insert(floorTodayTables).values({ tableId: row!.id });
  return { id: row!.id };
}

export async function switchOff(v: { db: Database }, tableId: string): Promise<void> {
  await withTransaction(v.db, async (tx) => {
    await tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId));
  });
}
