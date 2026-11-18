import { devices, type Database, type Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";

export async function setMadeHere(
  db: Database | Transaction,
  deviceId: string,
  stationIds: readonly string[],
): Promise<void> {
  await db
    .update(devices)
    .set({ madeHereStationIds: [...stationIds] })
    .where(eq(devices.id, deviceId));
}
