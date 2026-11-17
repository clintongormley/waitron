import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import {
  AppError,
  deviceId as brandDeviceId,
  diskFullIn,
  isUuid,
  PERSON_HEADER,
} from "@waitron/shared";
import type { DeviceId } from "@waitron/shared";
import { deviceNotDeleted, deviceProfiles, devices, nowIso, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorize,
  hashSessionToken,
  tillSessions,
  sightingDue,
  type Permission,
} from "@waitron/identity";
import type { ProfileAction } from "@waitron/layouts";
import {
  DEV_DEVICE_HEADER,
  type DeviceAuthDeps,
  deviceBindingColumns,
  assertProfileAction,
  deviceProfileJoin,
  requireDeviceProof,
  recordSighting,
  toDeviceBinding,
  type DeviceBinding,
} from "./device-session.js";
// Side-effect only: the file that throws `session.required` imports its registry.
import "./errors.js";

export const SESSION_COOKIE = "waitron_till_session";

/** The statuses of `requireSession`'s refusals of the session itself, for a surface's status map. */
export const SESSION_STATUS = {
  "session.required": 401,
  "session.person_not_signed_in": 409,
} as const satisfies Record<string, ContentfulStatusCode>;

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

function sessionCookieName(c: Context): string | null {
  const device = c.req.header(DEV_DEVICE_HEADER);
  return device === undefined
    ? SESSION_COOKIE
    : isUuid(device)
      ? `${SESSION_COOKIE}_${device}`
      : null;
}

/** `secure` comes from `TillApiDeps.secureCookies`: false when the host serves plain HTTP. */
export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  const name = sessionCookieName(c);
  if (name === null) throw new AppError("device.unauthorized", {});
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}

/** `path` must match the one `setSessionCookie` wrote with, or the browser keeps the original. */
export function clearSessionCookie(c: Context): void {
  const name = sessionCookieName(c);
  if (name !== null) deleteCookie(c, name, { path: "/" });
}

export function readSessionToken(c: Context): string | null {
  const name = sessionCookieName(c);
  return name === null ? null : (getCookie(c, name) ?? null);
}

export function hasSessionCookie(c: Context): boolean {
  return readSessionToken(c) !== null;
}

/** The person whose open session `token` names, on `deviceId` when one is given; `null` when it
 * names none. */
export async function openSessionPerson(
  db: Database | Transaction,
  token: string,
  deviceId?: string,
): Promise<string | null> {
  const [found] = await db
    .select({ personId: tillSessions.personId })
    .from(tillSessions)
    .where(
      and(
        eq(tillSessions.tokenHash, hashSessionToken(token)),
        deviceId === undefined ? undefined : eq(tillSessions.deviceId, deviceId),
        isNull(tillSessions.endedAt),
      ),
    );
  return found?.personId ?? null;
}

/**
 * The refusal for a request whose person header does not name `personId`, the person of its open
 * session; `null` when it names that person. A request naming no one, with no header, an empty one
 * or one that is not a UUID, is refused as another person is, and echoes no id.
 */
export function personRefusal(c: Context, personId: string): AppError | null {
  const named = canonicaliseUuid(c.req.header(PERSON_HEADER));
  if (named !== null && named === canonicaliseUuid(personId)) return null;
  return new AppError("session.person_not_signed_in", { personId: named });
}

/** Who is signed in on a device, as the request sees it. */
export type SignedInPerson =
  | { outcome: "nobody" }
  | { outcome: "person"; personId: string }
  | { outcome: "refused"; refusal: AppError };

/** The person of the request's open session on `deviceId`. Nobody when there is none: a missing,
 * unknown or ended session, or one opened on another device. Refused when the request does not
 * name that session's person. */
export async function signedInPersonOn(
  tx: Transaction,
  c: Context,
  deviceId: string,
): Promise<SignedInPerson> {
  const token = readSessionToken(c);
  if (token === null || !isUuid(token)) return { outcome: "nobody" };
  const personId = await openSessionPerson(tx, token, deviceId);
  if (personId === null) return { outcome: "nobody" };
  const refusal = personRefusal(c, personId);
  return refusal === null ? { outcome: "person", personId } : { outcome: "refused", refusal };
}

async function readSessionRow(tx: Database | Transaction, token: string, c: Context) {
  const [found] = await tx
    .select({
      id: tillSessions.id,
      personId: tillSessions.personId,
      deviceId: tillSessions.deviceId,
      active: devices.active,
      lastSeenAt: devices.lastSeenAt,
      ...deviceBindingColumns,
    })
    .from(tillSessions)
    // Always matches: `device_id` is NOT NULL with a RESTRICT foreign key.
    .innerJoin(devices, eq(devices.id, tillSessions.deviceId))
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(and(eq(tillSessions.tokenHash, hashSessionToken(token)), isNull(tillSessions.endedAt)));
  if (found === undefined) throw new AppError("session.required", {});
  if (!found.active) throw new AppError("device.unauthorized", {});
  const refusal = personRefusal(c, found.personId);
  if (refusal !== null) throw refusal;
  return found;
}

export async function readTillSession(db: Database, c: Context) {
  const token = readSessionToken(c);
  if (token === null || !isUuid(token)) throw new AppError("session.required", {});
  const row = await readSessionRow(db, token, c);
  return {
    personId: row.personId,
    sessionId: row.id,
    deviceId: brandDeviceId(row.deviceId),
    device: toDeviceBinding(row.deviceId, row),
  };
}

export async function checkDeviceStillProven(
  db: Database,
  deviceId: string,
  tokenHash: string | null,
): Promise<void> {
  const [row] = await db
    .select({ tokenHash: devices.tokenHash })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.active, true)));
  if (row === undefined || (tokenHash !== null && row.tokenHash !== tokenHash))
    throw new AppError("device.unauthorized", {});
}

/**
 * Resolves the request's cookie to an OPEN shift session and the device it was opened on, or throws
 * `session.required`. The lookup is by the token's hash with `ended_at IS NULL`, so an unknown token
 * and a logged-out session fail as a missing cookie does. A session whose device has been revoked
 * throws `device.unauthorized`, and a request not naming its person `session.person_not_signed_in`.
 * Login and logout deliberately do not call this. With `permission`,
 * the session's person must also hold it (`authorize`, no override), checked in the same
 * transaction; with `action`, the device's active profile must permit it (`assertProfileAction`)
 * and the request must prove that same device.
 * When a full disk refuses that transaction, the same checks run outside it and nothing is stamped.
 */
export async function requireSession(
  deps: DeviceAuthDeps,
  c: Context,
  options: { permission?: Permission; action?: ProfileAction; passive?: boolean } = {},
): Promise<{ personId: string; sessionId: string; deviceId: DeviceId; device: DeviceBinding }> {
  const chosen =
    c.req.header(DEV_DEVICE_HEADER) === undefined
      ? null
      : await requireDeviceProof(deps, c, { passive: true });
  const token = readSessionToken(c);
  if (token === null) throw new AppError("session.required", {});
  const check = async (tx: Database | Transaction, stamp: boolean) => {
    const found = await readSessionRow(tx, token, c);
    const seenAt = nowIso();
    if (stamp && sightingDue(found.lastSeenAt, seenAt))
      await recordSighting(tx, found.deviceId, seenAt);
    if (options.permission !== undefined) {
      await authorize(tx, { sessionId: found.id, permission: options.permission });
    }
    if (options.action !== undefined) {
      assertProfileAction(toDeviceBinding(found.deviceId, found), options.action);
    }
    return found;
  };
  let row: Awaited<ReturnType<typeof check>>;
  try {
    row = await withTransaction(deps.db, (tx) => check(tx, options.passive !== true));
  } catch (error) {
    if (!diskFullIn(error)) throw error;
    row = await check(deps.db, false);
  }
  if (chosen !== null) {
    if (chosen.device.deviceId !== row.deviceId) throw new AppError("device.unauthorized", {});
  } else if (options.action !== undefined) {
    await assertRequestDevice(deps, c, row);
  }
  return {
    personId: row.personId,
    sessionId: row.id,
    deviceId: brandDeviceId(row.deviceId),
    device: toDeviceBinding(row.deviceId, row),
  };
}

export async function assertRequestDevice(
  deps: DeviceAuthDeps,
  c: Context,
  session: { deviceId: string },
): Promise<void> {
  // Session resolution owns the activity stamp, including whether this request is passive.
  const proven = await requireDeviceProof(deps, c, { passive: true });
  if (proven.device.deviceId !== session.deviceId) throw new AppError("device.unauthorized", {});
}

/** Inside a write's own transaction: `sessionId` is still `personId`'s open session on `deviceId`
 * (else `session.required`), and the device is still active and not deleted (else `device.unauthorized`). */
export async function assertStillSignedIn(
  tx: Transaction,
  ids: { deviceId: string; sessionId: string; personId: string },
): Promise<void> {
  const [session] = await tx
    .select({ id: tillSessions.id })
    .from(tillSessions)
    .where(
      and(
        eq(tillSessions.id, ids.sessionId),
        eq(tillSessions.deviceId, ids.deviceId),
        eq(tillSessions.personId, ids.personId),
        isNull(tillSessions.endedAt),
      ),
    );
  if (session === undefined) throw new AppError("session.required", {});
  const [device] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, ids.deviceId), eq(devices.active, true), deviceNotDeleted()));
  if (device === undefined) throw new AppError("device.unauthorized", {});
}
