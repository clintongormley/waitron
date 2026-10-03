import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { AppError, deviceId as brandDeviceId, isUuid } from "@waitron/shared";
import type { DeviceId } from "@waitron/shared";
import { deviceProfiles, devices, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { authorize, hashSessionToken, sessions, type Permission } from "@waitron/identity";
import {
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
  type DeviceBinding,
} from "./device-session.js";
// Side-effect only: the file that throws `session.required` imports its registry.
import "./errors.js";

export const SESSION_COOKIE = "waitron_till_session";

export { isUuid };

/**
 * Canonicalise a UUID to the lowercase-hyphenated form `newId` mints, or `null` when the value is not
 * a UUID in any spelling. Two reasons to call it: the wrong-PIN throttle keys on the string
 * (`pin-throttle.ts`), so uncanonicalised spellings of one personId would each get a fresh back-off
 * bucket; and id columns are plain `text`, so a differently-spelled id matches no row.
 */
export function canonicaliseUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value
    .trim()
    .replace(/^\{(.*)\}$/, "$1")
    .replace(/-/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `secure` comes from `TillApiDeps.secureCookies`: false when the host serves plain HTTP. */
export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}

/** `path` must match the one `setSessionCookie` wrote with, or the browser keeps the original. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function readSessionToken(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

/**
 * Resolves the request's cookie to an OPEN shift session and the device it was opened on, or throws
 * `session.required`. The lookup is by the token's hash with `ended_at IS NULL`, so an unknown token
 * and a logged-out session fail as a missing cookie does. A session whose device has been revoked
 * throws `device.unauthorized`. Login and logout deliberately do not call this. With `permission`,
 * the session's person must also hold it (`authorize`, no override), checked in the same
 * transaction.
 */
export async function requireSession(
  deps: { db: Database },
  c: Context,
  options: { permission?: Permission } = {},
): Promise<{ personId: string; sessionId: string; deviceId: DeviceId; device: DeviceBinding }> {
  const token = readSessionToken(c);
  if (token === null || !isUuid(token)) throw new AppError("session.required", {});
  const row = await withTransaction(deps.db, async (tx) => {
    const [found] = await tx
      .select({
        id: sessions.id,
        personId: sessions.personId,
        deviceId: sessions.deviceId,
        active: devices.active,
        ...deviceBindingColumns,
      })
      .from(sessions)
      // Always matches: `device_id` is NOT NULL with a RESTRICT foreign key.
      .innerJoin(devices, eq(devices.id, sessions.deviceId))
      .innerJoin(deviceProfiles, deviceProfileJoin)
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.endedAt)));
    if (found === undefined) throw new AppError("session.required", {});
    if (!found.active) throw new AppError("device.unauthorized", {});
    if (options.permission !== undefined) {
      await authorize(tx, { sessionId: found.id, permission: options.permission });
    }
    return found;
  });
  return {
    personId: row.personId,
    sessionId: row.id,
    deviceId: brandDeviceId(row.deviceId),
    device: toDeviceBinding(row.deviceId, row),
  };
}
