import { kitchenStations, type Transaction } from "@waitron/db";
import type { ChangesAfterSending } from "@waitron/shared";
import { writeEditSentLines } from "@waitron/venue-service";
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
  // Writes the venue's switch too until A756 PR 8 Task 63.
  if (value !== "held") await writeEditSentLines(tx, value === "held-or-waiting");
  const updated = await update.returning({ id: kitchenStations.id });
  if (updated.length === 0)
    throw new Error("setChangesAfterSending: the database has no station yet");
}
