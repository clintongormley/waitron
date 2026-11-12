import { eq } from "drizzle-orm";
import {
  diningTables,
  newId,
  shortNameColumns,
  withTransaction,
  type Database,
  type Transaction,
  OFF_FLOOR,
} from "@waitron/db";

export async function createTable(
  tx: Transaction,
  _cfg: unknown,
  input: { label: string; zoneId: string; shortName?: string },
  options: { today?: boolean } = {},
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(diningTables)
    .values({
      id: newId(),
      label: input.label,
      zoneId: input.zoneId,
      ...shortNameColumns(input.shortName ?? null),
    })
    .returning({ id: diningTables.id });
  if (options.today !== false)
    await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, row!.id));
  return { id: row!.id };
}

export async function switchOff(v: { db: Database }, tableId: string): Promise<void> {
  await withTransaction(v.db, async (tx) => {
    await tx.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, tableId));
  });
}
