import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AppError } from "@waitron/shared";
import { asAppUser, devices, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { verifySecret } from "@waitron/identity";
// Side-effect only: keeps this host's `device.unauthorized` code (errors.ts) reachable from the file
// that throws it — the reachability convention `till-session.ts` follows for its host `session.required`
// code (a bare import, no value used here). See the note atop `errors.ts`.
import "./errors.js";
import type { DeviceKind } from "./device.js";
import { isUuid } from "./till-session.js";

/**
 * The name of the trusted-device cookie (device-identity-1 §3c) — a kitchen screen's parallel for the
 * till's `waitron_till_session`. One constant so the set/read/clear/require helpers below cannot drift
 * on the spelling. Named `waitron_device` per the spec (§3c), NOT `_session`: unlike the operator and
 * management SESSION cookies, this is a long-lived DEVICE identity, so it earns its own distinct name.
 */
export const DEVICE_COOKIE = "waitron_device";

/** How long the device cookie stays valid — one year in seconds (§3c). A kitchen display must remain
 * enrolled across reboots and power cuts, so — unlike the operator/management session cookies, which
 * carry NO `Max-Age` and die with the browser session — this one is deliberately long-lived. Instant
 * revocation does not depend on it: `requireDevice` rejects a `active = false` device regardless of the
 * cookie's remaining lifetime, so there is no token TTL to wait out. */
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Writes the device credential into the cookie. The value is the `${deviceId}.${token}` pair the enrol
 * route mints (§3c) — a SELECTOR (the row id) plus a VALIDATOR (the scrypt-checked token). Attributes
 * mirror the session cookies: `httpOnly` so no browser script can read the bearer token, `sameSite:
 * "Strict"` so it never rides a cross-site request, `path: "/"` so it covers the whole till app.
 * `secure` is caller-supplied — TRUE on a production HTTPS host, FALSE on loopback dev where there is
 * no TLS to attach it to. The `maxAge` is the ONE deviation from `setManagementCookie`/`setSessionCookie`
 * (long-lived — see `DEVICE_COOKIE_MAX_AGE_SECONDS`).
 */
export function setDeviceCookie(c: Context, value: string, secure: boolean): void {
  setCookie(c, DEVICE_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Clears the device cookie (un-enrol / revoke on this browser). `path` must match the one
 * `setDeviceCookie` wrote with, or the browser keeps the original alongside the expiry the delete emits.
 */
export function clearDeviceCookie(c: Context): void {
  deleteCookie(c, DEVICE_COOKIE, { path: "/" });
}

/** The raw device credential carried by the request's cookie, or `null` when the cookie is absent. The
 * non-throwing read `requireDevice` builds its shape check on. */
export function readDeviceCookie(c: Context): string | null {
  return getCookie(c, DEVICE_COOKIE) ?? null;
}

/** The identity a `requireDevice` call resolves the cookie to: which device it is, what KIND it is, and
 * the single station it is bound to (NULL only for a future non-station kind). The device-authenticated
 * KDS routes (Task 5) scope every read/bump to this `stationId` — a device cannot name another's. */
export interface DeviceBinding {
  deviceId: string;
  kind: DeviceKind;
  stationId: string | null;
}

/**
 * Authenticates the request's device cookie against the database, or throws `device.unauthorized`
 * (device-identity-1 §3c) — the guard every device-authenticated route runs first.
 *
 * The cookie is `${deviceId}.${token}`: the id SELECTS the row (scrypt is per-row-salted, so the id is
 * needed to fetch the salt) and the token VALIDATES it. Every failure — a missing or malformed cookie,
 * an unknown or REVOKED (`active = false`) device, or a token that does not `verifySecret` against the
 * stored hash — folds into the SAME `device.unauthorized`, so the response confirms neither a device's
 * existence nor its revocation state to whoever asked (the fail-closed reasoning in `errors.ts`).
 *
 * The lookup runs as `app_user` inside `withTenant`, so RLS hides another tenant's devices exactly as a
 * missing cookie would, and the `active = true` filter is what makes revocation INSTANT: a revoked row
 * is simply not found, with no token lifetime to expire. `verifySecret` (scrypt, `@waitron/identity`)
 * is constant-time — the token is NEVER compared with `===`. On success the sighting is recorded
 * (`last_seen_at = now()`, gated to at most one write per minute — see the UPDATE below) and the binding
 * returned; nothing is logged, and the token never leaves this function.
 *
 * `deps.cfg` is typed to the ONE field this reads — `tenantId` — matching `requireSession`, so any route
 * group carrying only `{ tenantId }` can gate on it without contriving a full config.
 */
export async function requireDevice(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
): Promise<DeviceBinding> {
  const raw = readDeviceCookie(c);
  if (raw === null) throw new AppError("device.unauthorized", {});
  // Split on the FIRST `.` only: the id is a UUID (no dots) and a base64url token has none either, but
  // splitting on the first separator keeps a token that somehow carried one intact rather than truncated.
  const dot = raw.indexOf(".");
  // `dot <= 0` rejects both a missing separator (indexOf → -1) and an empty selector (dot at index 0);
  // `dot === raw.length - 1` rejects an empty token. Either malformed shape is `device.unauthorized`.
  if (dot <= 0 || dot === raw.length - 1) throw new AppError("device.unauthorized", {});
  const deviceId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  // Screen the selector's SHAPE before the DB: a non-UUID id looked up against the `uuid` column would
  // raise `22P02` → an opaque 500 (the `isUuid` reasoning in `till-session.ts`), so a forged cookie
  // stays a clean `device.unauthorized` instead.
  if (!isUuid(deviceId)) throw new AppError("device.unauthorized", {});

  return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx
      .select({
        tokenHash: devices.tokenHash,
        kind: devices.deviceKind,
        stationId: devices.stationId,
      })
      .from(devices)
      // `active = true` is the revocation filter: a revoked device is simply not found. Parameterised
      // by Drizzle — `id` and the boolean both bind as `$n`, never string-concatenated.
      .where(and(eq(devices.id, deviceId), eq(devices.active, true)));
    if (row === undefined) throw new AppError("device.unauthorized", {});
    // Constant-time scrypt check (REUSED, never home-rolled): the token is never compared with `===`.
    if (!verifySecret(token, row.tokenHash)) throw new AppError("device.unauthorized", {});

    // Record the sighting, but SKIP the write when `last_seen_at` is already within the last minute:
    // `requireDevice` runs on EVERY authenticated request (the auth hot path), and the sole consumer
    // renders last-seen only to the MINUTE (`devices-screen.ts`'s `#lastSeen` slices to `HH:MM`), so a
    // sub-minute re-write is invisible write amplification. The gate keeps the FIRST sighting (NULL →
    // written, the differential proof the test pins) and one write per minute thereafter. Deferring the
    // write until `last_seen_at` is ≥1 minute stale means the DISPLAYED last-seen can lag true activity by
    // up to ~1 minute (not strictly sub-minute) — an acceptable bound for a coarse "last seen" indicator.
    // Parameterised by Drizzle — `id` binds as `$n`; the interval is a constant literal, never user input.
    await tx
      .update(devices)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(devices.id, deviceId),
          sql`(${devices.lastSeenAt} is null or ${devices.lastSeenAt} < now() - interval '1 minute')`,
        ),
      );
    return { deviceId, kind: row.kind, stationId: row.stationId };
  });
}
