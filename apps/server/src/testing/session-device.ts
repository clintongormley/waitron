import { eq } from "drizzle-orm";
import { devices, withTransaction, type Database } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { loginWithPin } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { SESSION_COOKIE } from "../till-session.js";

/**
 * A till device on `cfg`'s own till whose profile allows every capability: the device a fixture
 * opens its shift session on when the test is about something other than the device.
 */
export async function seedSessionDevice(db: Database, cfg: { tillId: string }): Promise<string> {
  return (await seedDevice(db, { tillId: cfg.tillId, capabilities: [...CAPABILITY_FLAGS] }))
    .deviceId;
}

/**
 * The cookie of `personId`'s shift session on a device of `cfg`'s till that has since been revoked:
 * the request every till route refuses `device.unauthorized`.
 */
export async function revokedDeviceSessionCookie(
  db: Database,
  cfg: { tillId: string },
  personId: string,
  pin: string,
): Promise<string> {
  const deviceId = await seedSessionDevice(db, cfg);
  const session = await withTransaction(db, (tx) => loginWithPin(tx, { deviceId, personId, pin }));
  await db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
  return `${SESSION_COOKIE}=${session.token}`;
}
