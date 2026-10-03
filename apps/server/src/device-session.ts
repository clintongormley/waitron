import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AppError, isUuid, tillId } from "@waitron/shared";
import type { TillId } from "@waitron/shared";
import { deviceProfiles, devices, nowIso, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { kindOfFormFactor } from "@waitron/layouts";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import { verifySecretAsync } from "@waitron/identity";
// Side-effect only: keeps `device.unauthorized` (errors.ts) reachable from the file that throws it.
import "./errors.js";
import type { TillConfig } from "./till-config.js";

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
  locationId: string;
  stationId: string | null;
  watcherId: string | null;
  tillId: string | null;
  deviceProfileId: string;
  receiptPrinterId: string | null;
  paymentSlipPrinterId: string | null;
  capabilities: CapabilityFlag[];
}

// The join always matches: `device_profile_id` is NOT NULL with a RESTRICT foreign key.
export const deviceProfileJoin = eq(deviceProfiles.id, devices.deviceProfileId);
export const deviceBindingColumns = {
  formFactor: deviceProfiles.formFactor,
  label: devices.label,
  locationId: devices.locationId,
  stationId: devices.stationId,
  watcherId: devices.watcherId,
  tillId: devices.tillId,
  deviceProfileId: devices.deviceProfileId,
  receiptPrinterId: devices.receiptPrinterId,
  paymentSlipPrinterId: devices.paymentSlipPrinterId,
  capabilities: deviceProfiles.capabilities,
};

/**
 * Devices whose token has already passed scrypt: the stored hash it passed against and the SHA-256
 * of that token. Skipping scrypt on a match is safe because the row's CURRENT hash is re-read on
 * every request and must equal the remembered one, and because the token is `randomBytes(32)`
 * (`join-requests.ts`), not a password, so a fast digest of it is not open to guessing.
 */
const verifiedTokens = new Map<string, { tokenHash: string; tokenDigest: Buffer }>();
export const VERIFIED_TOKENS_LIMIT = 256;

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

function alreadyVerified(deviceId: string, token: string, tokenHash: string): boolean {
  const entry = verifiedTokens.get(deviceId);
  if (entry === undefined) return false;
  if (entry.tokenHash !== tokenHash) {
    verifiedTokens.delete(deviceId);
    return false;
  }
  return timingSafeEqual(entry.tokenDigest, digestOf(token));
}

function rememberVerified(deviceId: string, token: string, tokenHash: string): void {
  verifiedTokens.delete(deviceId);
  if (verifiedTokens.size >= VERIFIED_TOKENS_LIMIT)
    verifiedTokens.delete(verifiedTokens.keys().next().value!);
  verifiedTokens.set(deviceId, { tokenHash, tokenDigest: digestOf(token) });
}

/**
 * Carries NO authentication: the caller has already fetched an `active` row and, on the cookie
 * path, verified the token. A `tokenHash` on the passed row is never copied through.
 */
export function toDeviceBinding(
  deviceId: string,
  // `capabilities` arrives as `unknown` (device-profiles.ts leaves the column untyped), so it is
  // cast here.
  row: Omit<DeviceBinding, "deviceId" | "capabilities"> & { capabilities: unknown },
): DeviceBinding {
  return {
    deviceId,
    formFactor: row.formFactor,
    label: row.label,
    locationId: row.locationId,
    stationId: row.stationId,
    watcherId: row.watcherId,
    tillId: row.tillId,
    deviceProfileId: row.deviceProfileId,
    receiptPrinterId: row.receiptPrinterId,
    paymentSlipPrinterId: row.paymentSlipPrinterId,
    capabilities: row.capabilities as CapabilityFlag[],
  };
}

/**
 * Reads and authenticates the request's device, returning the binding or `null` at EVERY miss — a
 * missing or malformed cookie, an unknown or revoked device, or a token that does not verify — so
 * `requireDevice`'s `device.unauthorized` confirms neither a device's existence nor its revocation
 * state. The id selects the row because scrypt is per-row-salted; the token validates it. Only a
 * cookie read that verifies writes (the `last_seen_at` sighting), and only when a sighting is due.
 *
 * The authenticating reads and the token check run outside `withTransaction`, which is the venue's
 * write lock, so scrypt never holds up a sale; a read issued while another caller's write is open
 * sees committed rows only (`packages/store/src/connections.ts`). The sighting write re-reads the
 * row inside its transaction first, so a revocation or a new token committed while this call
 * waited for the lock refuses the request, and a new binding is what it returns.
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
      const [row] = await deps.db
        .select(deviceBindingColumns)
        .from(devices)
        .innerJoin(deviceProfiles, deviceProfileJoin)
        .where(and(eq(devices.id, override), eq(devices.active, true)));
      return row === undefined ? null : toDeviceBinding(override, row);
    }
  }

  const raw = readDeviceCookie(c);
  if (raw === null) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const deviceId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!isUuid(deviceId)) return null;

  const readRow = async (on: Database | Transaction = deps.db) => {
    const [found] = await on
      .select({
        tokenHash: devices.tokenHash,
        lastSeenAt: devices.lastSeenAt,
        ...deviceBindingColumns,
      })
      .from(devices)
      .innerJoin(deviceProfiles, deviceProfileJoin)
      // `active = true` is the revocation filter: a revoked device is simply not found.
      .where(and(eq(devices.id, deviceId), eq(devices.active, true)));
    return found;
  };
  let row = await readRow();
  if (row === undefined) {
    verifiedTokens.delete(deviceId);
    return null;
  }
  if (!alreadyVerified(deviceId, token, row.tokenHash)) {
    const checkedHash = row.tokenHash;
    // Constant-time: the token is never compared with `===`.
    if (!(await verifySecretAsync(token, checkedHash))) return null;
    // A revocation, a new token or a new binding committed while scrypt ran wins over the row it
    // checked.
    row = await readRow();
    if (row === undefined || row.tokenHash !== checkedHash) return null;
    rememberVerified(deviceId, token, checkedHash);
  }

  // The check on the row read spares a request the write lock.
  const seenAt = nowIso();
  if (sightingDue(row.lastSeenAt, seenAt)) {
    const checkedHash = row.tokenHash;
    const locked = await withTransaction(deps.db, async (tx) => {
      // A revocation, a new token or a new binding committed while this request waited for the
      // lock wins.
      const current = await readRow(tx);
      if (current === undefined || current.tokenHash !== checkedHash) return undefined;
      await recordSighting(tx, deviceId, seenAt);
      return current;
    });
    if (locked === undefined) {
      verifiedTokens.delete(deviceId);
      return null;
    }
    row = locked;
  }
  return toDeviceBinding(deviceId, row);
}

// At most one sighting write a minute: it is checked on every authenticated request, and the
// dashboard shows last-seen only to the minute (`devices-screen.ts`'s `#lastSeen`).
//
// `last_seen_at` is text, so `<` on it compares strings, which orders two instants correctly only
// for the one spelling its writer uses: `toISOString()`, which is what `nowIso` returns.
const staleBefore = (seenAt: string): string =>
  new Date(Date.parse(seenAt) - SIGHTING_INTERVAL_MS).toISOString();

/** Whether a device last seen at `lastSeenAt` is due a fresh sighting at `seenAt`. */
export function sightingDue(lastSeenAt: string | null, seenAt: string): boolean {
  return lastSeenAt === null || lastSeenAt < staleBefore(seenAt);
}

/**
 * Records that `deviceId` was seen at `seenAt`, unless a sighting inside the last minute is already
 * recorded: the same check in the update keeps concurrent requests that all read a stale row to one
 * write.
 */
export async function recordSighting(
  tx: Transaction,
  deviceId: string,
  seenAt: string,
): Promise<void> {
  await tx
    .update(devices)
    .set({ lastSeenAt: seenAt })
    .where(
      and(
        eq(devices.id, deviceId),
        // A never-seen device has NULL here and `<` is UNKNOWN for NULL, so the first sighting
        // needs its own alternative or it would never be written.
        or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, staleBefore(seenAt))),
      ),
    );
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
 * The `till_id` a SALE files under, taken from `device`. A {@link DeviceBinding} carries no node or
 * series: the chain is keyed by the node, not the device. The refusal is a setup precondition — a
 * sellable device is till-bound — not a per-sale block (CLAUDE.md §5).
 */
export function requireSaleTillId(device: DeviceBinding): TillId {
  if (device.tillId === null) throw new AppError("device.till_required", {});
  return tillId(device.tillId);
}

/**
 * The configuration `device`'s request runs under: the device's own till, and a cash drawer only
 * for a till form factor. Refuses as {@link requireSaleTillId} does.
 */
export function deviceTillCfg<C extends TillConfig>(cfg: C, device: DeviceBinding): C {
  return {
    ...cfg,
    tillId: requireSaleTillId(device),
    allowCashDrawer: kindOfFormFactor(device.formFactor) === "till",
  };
}

/**
 * The handheld firewall: a handheld device may not reach a route that runs this guard. Enforced on
 * the server so the fence holds even if the client is bypassed.
 */
export function assertNotHandheld(device: DeviceBinding, action: string): void {
  if (kindOfFormFactor(device.formFactor) === "handheld") {
    throw new AppError("device.forbidden_action", { action });
  }
}

/**
 * The device-capability firewall: a device whose profile does not declare `capability` is refused,
 * fail-closed, with `device.forbidden_action`. `device` is a pre-resolved binding, `null` for no
 * device, which passes; omitted, the request's device cookie is read here.
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

/** A device whose profile does not take cash is refused a cash payment. No device passes, as in {@link assertDeviceCapability}. */
export function assertTakesCash(device: DeviceBinding | null): void {
  if (device !== null && !device.capabilities.includes("take-cash")) {
    throw new AppError("device.cash_not_allowed", {});
  }
}
