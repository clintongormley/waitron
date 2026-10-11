import { eq } from "drizzle-orm";
import {
  diningTables,
  floorTodayTables,
  newId,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { TillConfig } from "../till-config.js";

export async function createTable(
  tx: Transaction,
  cfg: TillConfig,
  input: { label: string; zoneId: string; capacity?: number },
  options: { today?: boolean } = {},
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(diningTables)
    .values({
      id: newId(),
      locationId: cfg.locationId,
      label: input.label,
      zoneId: input.zoneId,
      capacity: input.capacity ?? null,
    })
    .returning({ id: diningTables.id });
  if (options.today !== false) await tx.insert(floorTodayTables).values({ tableId: row!.id });
  return { id: row!.id };
}

export async function switchOff(v: { db: Database }, tableId: string): Promise<void> {
  await withTransaction(v.db, async (tx) => {
    await tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, tableId));
  });
}
