import { kitchenStations, type Transaction } from "@waitron/db";
import type { ChangesAfterSending } from "@waitron/shared";
import { inArray } from "drizzle-orm";

export async function setChangesAfterSending(
  tx: Transaction,
  value: ChangesAfterSending,
  stationIds?: readonly string[],
): Promise<void> {
  const update = tx.update(kitchenStations).set({ changesAfterSending: value });
  if (stationIds !== undefined) {
    const updated = await update
      .where(inArray(kitchenStations.id, [...stationIds]))
      .returning({ id: kitchenStations.id });
    if (updated.length !== stationIds.length)
      throw new Error(
        `setChangesAfterSending: ${stationIds.length - updated.length} id(s) match no station`,
      );
    return;
  }
  const updated = await update.returning({ id: kitchenStations.id });
  if (updated.length === 0)
    throw new Error("setChangesAfterSending: the database has no station yet");
}

export async function readChangesAfterSending(
  tx: Transaction,
): Promise<ReadonlyMap<string, ChangesAfterSending>> {
  const rows = await tx
    .select({ id: kitchenStations.id, value: kitchenStations.changesAfterSending })
    .from(kitchenStations);
  return new Map(rows.map((row) => [row.id, row.value]));
}
