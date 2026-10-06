import { eq } from "drizzle-orm";
import { devices, withTransaction, workingOrders, type Database } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { loginWithPin } from "@waitron/identity";
import { CAPABILITY_FLAGS, type ProfileAction } from "@waitron/layouts";
import { deviceOrigin, locationId as brandLocationId } from "@waitron/shared";
import type { DeviceOrigin } from "@waitron/shared";
import type { TillConfig } from "../till-config.js";
import { SESSION_COOKIE } from "../till-session.js";

/** Taking orders, a card keyed on a separate terminal, preparing and handing over: what a profile
 * did without listing anything until profiles named these actions. A fixture whose subject is
 * another flag lists them beside it. */
export const BASIC_ACTIONS = [
  "take-orders",
  "hand-keyed-card-payment",
  "prepare-orders",
  "hand-over-orders",
] as const satisfies readonly ProfileAction[];

/**
 * A till device at `cfg`'s location whose profile allows every capability: the device a fixture
 * opens its shift session on when the test is about something other than the device.
 */
export async function seedSessionDevice(
  db: Database,
  cfg: { locationId: string },
): Promise<string> {
  return (
    await seedDevice(db, {
      locationId: brandLocationId(cfg.locationId),
      capabilities: [...CAPABILITY_FLAGS],
    })
  ).deviceId;
}

/**
 * The cookie of `personId`'s shift session on a device at `cfg`'s location that has since been
 * revoked: the request every till route refuses `device.unauthorized`. Revoked out of band, because
 * the Disable route ends the device's sessions.
 */
export async function revokedDeviceSessionCookie(
  db: Database,
  cfg: { locationId: string },
  personId: string,
  pin: string,
): Promise<string> {
  const deviceId = await seedSessionDevice(db, cfg);
  const session = await withTransaction(db, (tx) => loginWithPin(tx, { deviceId, personId, pin }));
  await db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
  return `${SESSION_COOKIE}=${session.token}`;
}

/** `cfg` as a till-app request from a device seeded at its location, allowed every capability. */
export async function deviceRequestCfg<C extends TillConfig>(
  db: Database,
  cfg: C,
): Promise<C & { origin: DeviceOrigin }> {
  return { ...cfg, origin: deviceOrigin(await seedSessionDevice(db, cfg)) };
}

/** The origin of a device seeded at `workingOrderId`'s location, for a payment a fixture writes by hand. */
export async function orderDeviceOrigin(
  db: Database,
  workingOrderId: string,
): Promise<DeviceOrigin> {
  const [order] = await db
    .select({ locationId: workingOrders.locationId })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  return deviceOrigin(await seedSessionDevice(db, order!));
}

/** The origin and place of an order a fixture writes straight to the table: the dashboard, at `locationId`. */
export function dashboardOrderAt(locationId: string) {
  return { source: "dashboard", deviceId: null, locationId } as const;
}
