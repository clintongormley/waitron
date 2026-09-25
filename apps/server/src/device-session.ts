import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AppError, tillId } from "@waitron/shared";
import type { TillId } from "@waitron/shared";
import { deviceProfiles, devices, nowIso, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { kindOfFormFactor } from "@waitron/layouts";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import { verifySecret } from "@waitron/identity";
// Side-effect only: keeps `device.unauthorized` (errors.ts) reachable from the file that throws it.
import "./errors.js";
import { isUuid } from "./till-session.js";

/** The trusted-device cookie: a long-lived DEVICE identity, unlike the session cookies. */
export const DEVICE_COOKIE = "waitron_device";

/** How stale a recorded sighting has to be before an authenticated read writes a fresh one. */
const SIGHTING_INTERVAL_MS = 60_000;

/**
 * DEV-ONLY: in `devMode`, a request carrying this header is authenticated AS the named device
 * WITHOUT a token, so one browser can run several device identities in separate tabs. NEVER read
 * unless `deps.devMode` is true.
 */
export const DEV_DEVICE_HEADER = "x-waitron-dev-device";

/** One year: a kitchen display must stay enrolled across reboots and power cuts. Revocation does
 * not wait on it: `requireDevice` rejects an `active = false` device whatever the cookie's
 * lifetime. */
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The `Domain` a device cookie is scoped to: the tenant domain when the request host is it or a
 * subdomain of it, and host-only otherwise. The leading-dot check is what stops
 * `notdeli.waitron.app` from matching `deli.waitron.app`.
 */
export function cookieDomainFor(
  host: string | undefined,
  tenantDomain: string | undefined,
): string | undefined {
  if (host === undefined || tenantDomain === undefined) return undefined;
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  return bare === tenantDomain || bare.endsWith("." + tenantDomain) ? tenantDomain : undefined;
}

/**
 * The value is `${deviceId}.${token}`: the row id selects, the scrypt-checked token validates. The
 * `Domain` is resolved here, as {@link clearDeviceCookie} resolves it, so both compute the SAME
 * scope — an un-enrol that cleared a differently-scoped cookie would fail to delete it.
 */
export function setDeviceCookie(
  c: Context,
  value: string,
  secure: boolean,
  tenantDomain?: string,
): void {
  const domain = cookieDomainFor(c.req.header("host"), tenantDomain);
  setCookie(c, DEVICE_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    ...(domain === undefined ? {} : { domain }),
  });
}

/** `path` and `Domain` must match what {@link setDeviceCookie} wrote, or the browser keeps the
 * original cookie. */
export function clearDeviceCookie(c: Context, tenantDomain?: string): void {
  const domain = cookieDomainFor(c.req.header("host"), tenantDomain);
  deleteCookie(c, DEVICE_COOKIE, { path: "/", ...(domain === undefined ? {} : { domain }) });
}

export function readDeviceCookie(c: Context): string | null {
  return getCookie(c, DEVICE_COOKIE) ?? null;
}

/** The identity a `requireDevice` call resolves the cookie to. The reader default lives in
 * `device_card_readers`, not on this row. */
export interface DeviceBinding {
  deviceId: string;
  // Read from the device's profile; the device KIND is derived from it via `kindOfFormFactor`.
  formFactor: FormFactor;
  label: string;
  stationId: string | null;
  tillId: string | null;
  deviceProfileId: string | null;
  receiptPrinterId: string | null;
  hasCashDrawer: boolean;
  capabilities: CapabilityFlag[];
}

// The join always matches: `device_profile_id` is NOT NULL with a RESTRICT foreign key.
const deviceProfileJoin = eq(deviceProfiles.id, devices.deviceProfileId);
const deviceBindingColumns = {
  formFactor: deviceProfiles.formFactor,
  label: devices.label,
  stationId: devices.stationId,
  tillId: devices.tillId,
  deviceProfileId: devices.deviceProfileId,
  receiptPrinterId: devices.receiptPrinterId,
  hasCashDrawer: devices.hasCashDrawer,
  capabilities: deviceProfiles.capabilities,
};

/**
 * Carries NO authentication: the caller has already fetched an `active` row and, on the cookie
 * path, verified the token. A `tokenHash` on the passed row is never copied through.
 */
function toDeviceBinding(
  deviceId: string,
  // `capabilities` arrives as `unknown` (device-profiles.ts leaves the column untyped), so it is
  // cast here.
  row: Omit<DeviceBinding, "deviceId" | "capabilities"> & { capabilities: unknown },
): DeviceBinding {
  return {
    deviceId,
    formFactor: row.formFactor,
    label: row.label,
    stationId: row.stationId,
    tillId: row.tillId,
    deviceProfileId: row.deviceProfileId,
    receiptPrinterId: row.receiptPrinterId,
    hasCashDrawer: row.hasCashDrawer,
    capabilities: row.capabilities as CapabilityFlag[],
  };
}

/**
 * Reads and authenticates the request's device, returning the binding or `null` at EVERY miss — a
 * missing or malformed cookie, an unknown or revoked device, or a token that does not verify — so
 * `requireDevice`'s `device.unauthorized` confirms neither a device's existence nor its revocation
 * state. The id selects the row because scrypt is per-row-salted; the token validates it. Only a
 * successful cookie read writes (the `last_seen_at` sighting); every other path is a pure read.
 */
export async function tryReadDevice(
  deps: { db: Database; devMode?: boolean },
  c: Context,
): Promise<DeviceBinding | null> {
  // The dev header WINS over the cookie and does not fall back to it: an override naming a bad
  // device is a clean miss, not a silent switch to the cookie's identity.
  if (deps.devMode === true) {
    const override = c.req.header(DEV_DEVICE_HEADER);
    if (override !== undefined) {
      if (!isUuid(override)) return null;
      return withTransaction(deps.db, async (tx) => {
        const [row] = await tx
          .select(deviceBindingColumns)
          .from(devices)
          .innerJoin(deviceProfiles, deviceProfileJoin)
          .where(and(eq(devices.id, override), eq(devices.active, true)));
        if (row === undefined) return null;
        return toDeviceBinding(override, row);
      });
    }
  }

  const raw = readDeviceCookie(c);
  if (raw === null) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const deviceId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!isUuid(deviceId)) return null;

  return withTransaction(deps.db, async (tx) => {
    const [row] = await tx
      .select({ tokenHash: devices.tokenHash, ...deviceBindingColumns })
      .from(devices)
      .innerJoin(deviceProfiles, deviceProfileJoin)
      // `active = true` is the revocation filter: a revoked device is simply not found.
      .where(and(eq(devices.id, deviceId), eq(devices.active, true)));
    if (row === undefined) return null;
    // Constant-time: the token is never compared with `===`.
    if (!verifySecret(token, row.tokenHash)) return null;

    // At most one sighting write a minute: this runs on every authenticated request, and the
    // dashboard shows last-seen only to the minute (`devices-screen.ts`'s `#lastSeen`).
    //
    // `last_seen_at` is a text column, so `<` on it is a STRING comparison, which orders two
    // instants correctly only for the one spelling its writer uses: `toISOString()`, which is what
    // `nowIso` returns. The clock is read once so the stamp written and the staleness cutoff are
    // the same moment.
    const seenAt = nowIso();
    const staleBefore = new Date(Date.parse(seenAt) - SIGHTING_INTERVAL_MS).toISOString();
    await tx
      .update(devices)
      .set({ lastSeenAt: seenAt })
      .where(
        and(
          eq(devices.id, deviceId),
          // A never-seen device has NULL here and `<` is UNKNOWN for NULL, so the first sighting
          // needs its own alternative or it would never be written.
          or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, staleBefore)),
        ),
      );
    return toDeviceBinding(deviceId, row);
  });
}

/** Throwing wrapper over {@link tryReadDevice}: every miss becomes the SAME
 * `device.unauthorized`. */
export async function requireDevice(
  deps: { db: Database; devMode?: boolean },
  c: Context,
): Promise<DeviceBinding> {
  const device = await tryReadDevice(deps, c);
  if (device === null) throw new AppError("device.unauthorized", {});
  return device;
}

/**
 * The `till_id` a SALE files under, taken from the authenticated device, so a box files under the
 * till its own enrolment names. A {@link DeviceBinding} carries no node or series: the chain is
 * keyed by the node, not the device. Both refusals are setup preconditions — a sellable box must be
 * an enrolled, till-bound device — not a per-sale block (CLAUDE.md §5).
 *
 * `device` is an optional pre-resolved binding, so a route running several device guards reads it
 * once: `null` means "resolved, no device"; omitted (`undefined`) means read it here.
 */
export async function requireSaleTillId(
  deps: { db: Database; devMode?: boolean },
  c: Context,
  device?: DeviceBinding | null,
): Promise<TillId> {
  const resolved = device === undefined ? await tryReadDevice(deps, c) : device;
  if (resolved === null) throw new AppError("device.unauthorized", {});
  if (resolved.tillId === null) throw new AppError("device.till_required", {});
  return tillId(resolved.tillId);
}

/**
 * The handheld firewall: a handheld device may not reach a route that runs this guard. Enforced on
 * the server so the fence holds even if the client is bypassed. No device (an operator-session
 * till) and a non-handheld device both pass. `device` as in {@link requireSaleTillId}.
 */
export async function assertNotHandheld(
  deps: { db: Database; devMode?: boolean },
  c: Context,
  action: string,
  device?: DeviceBinding | null,
): Promise<void> {
  const resolved = device === undefined ? await tryReadDevice(deps, c) : device;
  if (resolved !== null && kindOfFormFactor(resolved.formFactor) === "handheld") {
    throw new AppError("device.forbidden_action", { action });
  }
}

/**
 * The device-capability firewall: a device whose profile does not declare `capability` is refused,
 * fail-closed, with `device.forbidden_action`. No device (an operator-session till) passes, as in
 * {@link assertNotHandheld}. `device` as in {@link requireSaleTillId}.
 */
export async function assertDeviceCapability(
  deps: { db: Database; devMode?: boolean },
  c: Context,
  capability: CapabilityFlag,
  action: string,
  device?: DeviceBinding | null,
): Promise<void> {
  const resolved = device === undefined ? await tryReadDevice(deps, c) : device;
  if (resolved === null) return;
  if (!resolved.capabilities.includes(capability)) {
    throw new AppError("device.forbidden_action", { action });
  }
}
