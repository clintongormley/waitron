import { kitchenStations, watchers, withTransaction, type Database } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { deviceProfileStations, deviceProfileWatchers } from "@waitron/venue-service";
import { createJoinRequest, acceptDeviceJoinRequest } from "../join-requests.js";
import type { TillConfig } from "../till-config.js";

/**
 * Add the station or watcher to the profile's list, as a manager does before choosing it for a
 * kitchen screen. An id that names no row is left off, so the binding's own check still refuses it.
 */
export async function listOnProfile(
  tx: Transaction,
  profileId: string,
  choice: { stationId?: string | null; watcherId?: string | null },
): Promise<void> {
  if (choice.stationId != null) {
    const [station] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, choice.stationId));
    if (station !== undefined)
      await tx
        .insert(deviceProfileStations)
        .values({ deviceProfileId: profileId, stationId: station.id })
        .onConflictDoNothing({
          target: [deviceProfileStations.deviceProfileId, deviceProfileStations.stationId],
        });
  }
  if (choice.watcherId != null) {
    const [watcher] = await tx
      .select({ id: watchers.id })
      .from(watchers)
      .where(eq(watchers.id, choice.watcherId));
    if (watcher !== undefined)
      await tx
        .insert(deviceProfileWatchers)
        .values({ deviceProfileId: profileId, watcherId: watcher.id })
        .onConflictDoNothing({
          target: [deviceProfileWatchers.deviceProfileId, deviceProfileWatchers.watcherId],
        });
  }
}

/**
 * Enrol a device — knock, then accept — in one call. Deliberately NOT a production verb: it bypasses
 * the pairing window, the number check and the claim, which a route must never do. A station or
 * watcher it is given is first listed on the profile ({@link listOnProfile}).
 */
export async function enrolDeviceForTest(
  db: Database,
  cfg: TillConfig,
  input: {
    name: string;
    profileId: string;
    stationId?: string;
    watcherId?: string;
  },
): Promise<{ deviceId: string; token: string }> {
  return withTransaction(db, async (tx) => {
    await listOnProfile(tx, input.profileId, input);
    const made = await createJoinRequest(tx, cfg, { kind: "device", label: input.name });
    const accepted = await acceptDeviceJoinRequest(tx, cfg, made.joinId, {
      label: input.name,
      profileId: input.profileId,
      stationId: input.stationId ?? null,
      watcherId: input.watcherId ?? null,
    });
    return { deviceId: accepted.deviceId, token: made.token };
  });
}
