import { floorZones, kitchenStations, withTransaction, type Database } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { inArray } from "drizzle-orm";
import type { DeviceKitchenScreen } from "@waitron/module";
import { createJoinRequest, acceptDeviceJoinRequest } from "../join-requests.js";
import type { TillConfig } from "../till-config.js";
import { VENUE_SERVICE } from "../modules.js";

/**
 * Enrol a device — knock, then accept — in one call. Deliberately NOT a production verb: it bypasses
 * the pairing window, the number check and the claim, which a route must never do. A `stationId` is
 * a station screen on that one station; it and a `kitchenScreen` are first added to the profile,
 * which never narrows it or another device.
 */
export async function enrolDeviceForTest(
  db: Database,
  cfg: TillConfig,
  input: {
    name: string;
    profileId: string;
    stationId?: string;
    kitchenScreen?: DeviceKitchenScreen;
  },
): Promise<{ deviceId: string; token: string }> {
  return withTransaction(db, async (tx) => {
    const kitchenScreens: DeviceKitchenScreen[] = [];
    if (input.stationId !== undefined)
      kitchenScreens.push({ kind: "station", stationIds: [input.stationId], zoneIds: null });
    if (input.kitchenScreen !== undefined) kitchenScreens.push(input.kitchenScreen);
    for (const screen of kitchenScreens) await offerOnProfile(tx, cfg, input.profileId, screen);
    const made = await createJoinRequest(tx, cfg, { kind: "device", label: input.name });
    const accepted = await acceptDeviceJoinRequest(tx, cfg, made.joinId, {
      label: input.name,
      profileId: input.profileId,
      kitchenScreens,
    });
    return { deviceId: accepted.deviceId, token: made.token };
  });
}

/** Offers the screen on the profile, less any station or zone that names no row, so the device's
 *  own check still refuses that one. */
export async function offerOnProfile(
  tx: Transaction,
  cfg: TillConfig,
  profileId: string,
  screen: DeviceKitchenScreen,
): Promise<void> {
  const stationIds =
    screen.stationIds === null
      ? null
      : (
          await tx
            .select({ id: kitchenStations.id })
            .from(kitchenStations)
            .where(inArray(kitchenStations.id, [...screen.stationIds]))
        ).map((row) => row.id);
  const zoneIds =
    screen.zoneIds === null
      ? null
      : (
          await tx
            .select({ id: floorZones.id })
            .from(floorZones)
            .where(inArray(floorZones.id, [...screen.zoneIds]))
        ).map((row) => row.id);
  if (stationIds?.length === 0 || zoneIds?.length === 0) return;
  await VENUE_SERVICE.addProfileKitchenScreen(tx, cfg, profileId, {
    kind: screen.kind,
    stationIds,
    zoneIds,
  });
}
