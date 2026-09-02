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
 * KDS routes (Task 5) scope every read/bump to this `stationId` — a device cannot name another's.
 *
 * SP-A.2 §16 widened this with the device's assigned PROFILE + TILL + static HARDWARE bindings, all read
 * straight off the row so the boot reads (`/api/device/me`, `/api/till`) can surface them and the client
 * can (SP-B) boot into its profile. `tillId` — the `tills` row a sale-capable device rings against
 * (§16.4; NULL for a `kds_station`). `layoutProfileId` — the assigned layout profile (§16.3; NULL when
 * unassigned). The hardware trio — the per-device `receiptPrinterId` (NULL when none), `hasCashDrawer`,
 * `cardProvider` (config token, defaults `"none"`), and `cardReaderId` (NULL when none). None is a
 * credential; the reader's secrets stay in the vault, never on this row. */
export interface DeviceBinding {
  deviceId: string;
  kind: DeviceKind;
  stationId: string | null;
  tillId: string | null;
  layoutProfileId: string | null;
  receiptPrinterId: string | null;
  hasCashDrawer: boolean;
  cardProvider: string;
  cardReaderId: string | null;
}

/**
 * Reads and authenticates the request's device cookie against the database, returning the binding on
 * success or `null` at EVERY miss (device-identity-1 §3c) — the non-throwing core `requireDevice` and
 * `assertNotHandheld` share. A caller that needs the cookie present throws; a caller that only needs to
 * know WHETHER (and what KIND of) device is present — the handheld firewall guard `assertNotHandheld` —
 * branches on the `null`.
 *
 * The cookie is `${deviceId}.${token}`: the id SELECTS the row (scrypt is per-row-salted, so the id is
 * needed to fetch the salt) and the token VALIDATES it. Every miss — a missing or malformed cookie, an
 * unknown or REVOKED (`active = false`) device, or a token that does not `verifySecret` against the
 * stored hash — returns the SAME `null`, so `requireDevice`'s `device.unauthorized` confirms neither a
 * device's existence nor its revocation state to whoever asked (the fail-closed reasoning in `errors.ts`).
 *
 * The lookup runs as `app_user` inside `withTenant`, so RLS hides another tenant's devices exactly as a
 * missing cookie would, and the `active = true` filter is what makes revocation INSTANT: a revoked row
 * is simply not found, with no token lifetime to expire. `verifySecret` (scrypt, `@waitron/identity`)
 * is constant-time — the token is NEVER compared with `===`. On success the sighting is recorded
 * (`last_seen_at = now()`, gated to at most one write per minute — see the UPDATE below) and the binding
 * returned; nothing is logged, and the token never leaves this function. The `last_seen_at` write
 * happens ONLY on the success path, so a firewall probe on a non-device request is a pure read.
 *
 * `deps.cfg` is typed to the ONE field this reads — `tenantId` — matching `requireSession`, so any route
 * group carrying only `{ tenantId }` can gate on it without contriving a full config.
 */
export async function tryReadDevice(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
): Promise<DeviceBinding | null> {
  const raw = readDeviceCookie(c);
  if (raw === null) return null;
  // Split on the FIRST `.` only: the id is a UUID (no dots) and a base64url token has none either, but
  // splitting on the first separator keeps a token that somehow carried one intact rather than truncated.
  const dot = raw.indexOf(".");
  // `dot <= 0` rejects both a missing separator (indexOf → -1) and an empty selector (dot at index 0);
  // `dot === raw.length - 1` rejects an empty token. Either malformed shape is a miss.
  if (dot <= 0 || dot === raw.length - 1) return null;
  const deviceId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  // Screen the selector's SHAPE before the DB: a non-UUID id looked up against the `uuid` column would
  // raise `22P02` → an opaque 500 (the `isUuid` reasoning in `till-session.ts`), so a forged cookie
  // stays a clean miss instead.
  if (!isUuid(deviceId)) return null;

  return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx
      .select({
        tokenHash: devices.tokenHash,
        kind: devices.deviceKind,
        stationId: devices.stationId,
        // The profile/till/hardware bindings (SP-A.2 §16) surfaced on the binding — read here so the
        // boot reads echo them without a second query. All non-secret config, never credentials.
        tillId: devices.tillId,
        layoutProfileId: devices.layoutProfileId,
        receiptPrinterId: devices.receiptPrinterId,
        hasCashDrawer: devices.hasCashDrawer,
        cardProvider: devices.cardProvider,
        cardReaderId: devices.cardReaderId,
      })
      .from(devices)
      // `active = true` is the revocation filter: a revoked device is simply not found. Parameterised
      // by Drizzle — `id` and the boolean both bind as `$n`, never string-concatenated.
      .where(and(eq(devices.id, deviceId), eq(devices.active, true)));
    if (row === undefined) return null;
    // Constant-time scrypt check (REUSED, never home-rolled): the token is never compared with `===`.
    if (!verifySecret(token, row.tokenHash)) return null;

    // Record the sighting, but SKIP the write when `last_seen_at` is already within the last minute:
    // this read runs on EVERY authenticated request (the auth hot path), and the sole consumer
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
    return {
      deviceId,
      kind: row.kind,
      stationId: row.stationId,
      tillId: row.tillId,
      layoutProfileId: row.layoutProfileId,
      receiptPrinterId: row.receiptPrinterId,
      hasCashDrawer: row.hasCashDrawer,
      cardProvider: row.cardProvider,
      cardReaderId: row.cardReaderId,
    };
  });
}

/**
 * Authenticates the request's device cookie, or throws `device.unauthorized` (device-identity-1 §3c) —
 * the guard every device-authenticated route runs first. A thin throwing wrapper over
 * {@link tryReadDevice}: every miss the core returns `null` for folds into the SAME
 * `device.unauthorized`, so the response confirms neither a device's existence nor its revocation state.
 * All the authentication and the `last_seen_at` book-keeping live in `tryReadDevice`.
 */
export async function requireDevice(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
): Promise<DeviceBinding> {
  const device = await tryReadDevice(deps, c);
  if (device === null) throw new AppError("device.unauthorized", {});
  return device;
}

/**
 * The handheld firewall (spec §5, decision 0.1; owner reversal 2026-08-30, widened same day): a handheld
 * device may not reach THIS fiscal/cash route at all. A handheld takes and fires orders, and settles a
 * sale on `POST /api/sales` for cash OR a manual card tender — both file under the node's SIF (`nodeId`),
 * not the till (record-sale.ts:79-82), so that route runs NO handheld guard. But every route that runs
 * THIS guard — the INTEGRATED card reader (`/api/pay`), reprint, drawer, place, collect, cancel — settles
 * at the fixed till and is refused outright. Enforced ON THE SERVER so the fence holds even if the client
 * were bypassed, guarding an UNRECOVERABLE fiscal record (CLAUDE.md §5). Called AFTER the route's session
 * guard, on the SAME request.
 *
 * Absence of a device cookie — an ordinary till, which authenticates by operator SESSION and carries no
 * `waitron_device` — passes (`tryReadDevice` → `null`). A non-handheld device (a KDS station, which
 * never posts to a sale route anyway) also passes. ONLY an active `handheld` binding is refused, with
 * `device.forbidden_action` naming the attempted `action`.
 */
export async function assertNotHandheld(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
  action: string,
): Promise<void> {
  const device = await tryReadDevice(deps, c);
  if (device?.kind === "handheld") throw new AppError("device.forbidden_action", { action });
}
