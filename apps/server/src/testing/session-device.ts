import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { devices, withTransaction, type Database } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { hashSessionToken, loginWithPin, sessions } from "@waitron/identity";
import { CAPABILITY_FLAGS, type ProfileAction } from "@waitron/layouts";
import { deviceOrigin } from "@waitron/shared";
import type { DeviceOrigin } from "@waitron/shared";
import type { TradingContext } from "../trading-context.js";
import { SESSION_COOKIE } from "../till-session.js";
import { deviceCookieForTest } from "./enrol.js";

/** Adds device proof to a fixture's existing shift session, replacing its device token. */
export async function sessionCookieForTest(db: Database, token: string): Promise<string> {
  const [session] = await db
    .select({ deviceId: sessions.deviceId })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)));
  return `${SESSION_COOKIE}=${token}; ${await deviceCookieForTest(db, session!.deviceId)}`;
}

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
 * A till device at the venue whose profile allows every capability: the device a fixture
 * opens its shift session on when the test is about something other than the device.
 */
export async function seedSessionDevice(db: Database): Promise<string> {
  return (
    await seedDevice(db, {
      capabilities: [...CAPABILITY_FLAGS],
    })
  ).deviceId;
}

/** Opens a shift session for `personId` on `deviceId` and answers its id. */
export async function openTillSession(
  db: Database,
  opts: { deviceId: string; personId: string },
): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values({ ...opts, tokenHash: hashSessionToken(randomUUID()) })
    .returning({ id: sessions.id });
  return row!.id;
}

/**
 * The cookie of `personId`'s shift session on a device at the venue that has since been
 * revoked: the request every till route refuses `device.unauthorized`. Revoked out of band, because
 * the Disable route ends the device's sessions.
 */
export async function revokedDeviceSessionCookie(
  db: Database,
  personId: string,
  pin: string,
): Promise<string> {
  const deviceId = await seedSessionDevice(db);
  const session = await withTransaction(db, (tx) => loginWithPin(tx, { deviceId, personId, pin }));
  await db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
  return `${SESSION_COOKIE}=${session.token}`;
}

/** `cfg` as a till-app request from a device seeded at the venue, allowed every capability. */
export async function deviceRequestCfg<C extends TradingContext>(
  db: Database,
  cfg: C,
): Promise<C & { origin: DeviceOrigin }> {
  return { ...cfg, origin: deviceOrigin(await seedSessionDevice(db)) };
}

/** The origin of a device seeded at the venue, for a payment a fixture writes by hand. */
export async function orderDeviceOrigin(db: Database): Promise<DeviceOrigin> {
  return deviceOrigin(await seedSessionDevice(db));
}
