import { eq } from "drizzle-orm";
import { deviceProfiles, devices, withTransaction, type Database } from "@waitron/db";
import { loginWithPin } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { SESSION_COOKIE } from "../till-session.js";

let seeded = 0;

/**
 * A till device on `cfg`'s own till whose profile allows every capability: the device a fixture
 * opens its shift session on when the test is about something other than the device. A direct
 * insert, because pairing a till device creates a new till rather than naming `cfg.tillId`.
 */
export async function seedSessionDevice(
  db: Database,
  cfg: { locationId: string; tillId: string },
): Promise<string> {
  seeded += 1;
  return withTransaction(db, async (tx) => {
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: `Session device profile ${seeded}`,
        formFactor: "till",
        capabilities: [...CAPABILITY_FLAGS],
      })
      .returning({ id: deviceProfiles.id });
    const [device] = await tx
      .insert(devices)
      .values({
        locationId: cfg.locationId,
        deviceProfileId: profile!.id,
        tillId: cfg.tillId,
        label: `Session device ${seeded}`,
        tokenHash: "seeded",
      })
      .returning({ id: devices.id });
    return device!.id;
  });
}

/**
 * The cookie of `personId`'s shift session on a device of `cfg`'s till that has since been revoked:
 * the request every till route refuses `device.unauthorized`.
 */
export async function revokedDeviceSessionCookie(
  db: Database,
  cfg: { locationId: string; tillId: string },
  personId: string,
  pin: string,
): Promise<string> {
  const deviceId = await seedSessionDevice(db, cfg);
  const session = await withTransaction(db, (tx) => loginWithPin(tx, { deviceId, personId, pin }));
  await db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
  return `${SESSION_COOKIE}=${session.token}`;
}
