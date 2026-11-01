import { kitchenStations, type Transaction } from "@waitron/db";
import { inArray } from "drizzle-orm";

export async function setStationsWaitForPass(
  tx: Transaction,
  value: boolean,
  stationIds: readonly string[],
): Promise<void> {
  const updated = await tx
    .update(kitchenStations)
    .set({ waitsForPass: value })
    .where(inArray(kitchenStations.id, [...stationIds]))
    .returning({ id: kitchenStations.id });
  if (updated.length !== stationIds.length)
    throw new Error(
      `setStationsWaitForPass: ${stationIds.length - updated.length} id(s) match no station`,
    );
}
