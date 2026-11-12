import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { deviceProfiles, devices, withTransaction, type Database } from "@waitron/db";
import type { DeviceKitchenScreen } from "@waitron/module";
import { VENUE_SERVICE } from "../modules.js";

/** A device profile with a unique name and no capabilities. */
export async function profile(db: Database, formFactor: "kds" | "till"): Promise<string> {
  const [row] = await seedDeviceProfiles(db, { name: randomUUID(), formFactor, capabilities: [] });
  return row!.id;
}

/** A device row, given `screen` offered on its profile. */
export async function kitchenScreenDevice(
  db: Database,
  row: typeof devices.$inferInsert,
  screen: DeviceKitchenScreen,
): Promise<string> {
  const [device] = await db.insert(devices).values(row).returning({ id: devices.id });
  await withTransaction(db, async (tx) => {
    await VENUE_SERVICE.addProfileKitchenScreen(tx, row.deviceProfileId, screen);
    await VENUE_SERVICE.setDeviceKitchenScreens(tx, {
      deviceId: device!.id,
      profileId: row.deviceProfileId,
      screens: [screen],
    });
  });
  return device!.id;
}
