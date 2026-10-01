import { eq } from "drizzle-orm";
import { deviceMadeHereStations, type Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";
import { requireLiveStation } from "./kitchen.js";

/** The stations whose items `deviceId` makes on the spot. An absent device needs no query. */
export async function readMadeHereStations(
  tx: Transaction,
  deviceId: string | undefined,
): Promise<ReadonlySet<string>> {
  if (deviceId === undefined) return new Set();
  const rows = await tx
    .select({ stationId: deviceMadeHereStations.stationId })
    .from(deviceMadeHereStations)
    .where(eq(deviceMadeHereStations.deviceId, deviceId));
  return new Set(rows.map((row) => row.stationId));
}

/** Every device's list, with station ids in stable order. */
export async function listMadeHereStations(tx: Transaction): Promise<Map<string, string[]>> {
  const rows = await tx
    .select()
    .from(deviceMadeHereStations)
    .orderBy(deviceMadeHereStations.deviceId, deviceMadeHereStations.stationId);
  const byDevice = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byDevice.get(row.deviceId) ?? [];
    ids.push(row.stationId);
    byDevice.set(row.deviceId, ids);
  }
  return byDevice;
}

/** Replace one device's list after checking every station belongs to this location and is live. */
export async function setMadeHereStations(
  tx: Transaction,
  cfg: TillConfig,
  deviceId: string,
  stationIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(stationIds)];
  for (const stationId of ids) await requireLiveStation(tx, cfg, stationId);
  await tx.delete(deviceMadeHereStations).where(eq(deviceMadeHereStations.deviceId, deviceId));
  if (ids.length > 0) {
    await tx
      .insert(deviceMadeHereStations)
      .values(ids.map((stationId) => ({ deviceId, stationId })));
  }
}
