import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  devices,
  tills,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { loginWithPin } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { deviceOrigin, locationId as brandLocationId } from "@waitron/shared";
import type { DeviceOrigin } from "@waitron/shared";
import type { TillConfig } from "../till-config.js";
import { SESSION_COOKIE } from "../till-session.js";

/**
 * A fresh till at `locationId`, for a device a test inserts by hand to name: a till device still names
 * one until the tills table goes, and setup makes none.
 */
export async function fixtureTill(db: Database | Transaction, locationId: string): Promise<string> {
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: `Caja ${randomUUID()}` })
    .returning({ id: tills.id });
  return till!.id;
}

/**
 * The till "Caja 1" at `locationId`, made on first use: the register a test's handheld rings into, or
 * whose printer it reads, until the tills table goes. Setup makes none.
 */
export async function venueTill(db: Database | Transaction, locationId: string): Promise<string> {
  const [existing] = await db
    .select({ id: tills.id })
    .from(tills)
    .where(and(eq(tills.locationId, locationId), eq(tills.name, "Caja 1")));
  if (existing !== undefined) return existing.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  return till!.id;
}

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
 * revoked: the request every till route refuses `device.unauthorized`.
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
  const { deviceId } = await seedDevice(db, {
    locationId: brandLocationId(order!.locationId),
    capabilities: [...CAPABILITY_FLAGS],
  });
  return deviceOrigin(deviceId);
}

/** The origin and place of an order a fixture writes straight to the table: the dashboard, at `locationId`. */
export function dashboardOrderAt(locationId: string) {
  return { source: "dashboard", deviceId: null, locationId } as const;
}
