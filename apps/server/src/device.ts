// Side-effect only: keeps the `device.*` codes (errors.ts) reachable from the file that throws them.
import "./errors.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { requireBodyUuid } from "@waitron/server-kit";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  constraintTarget,
  deviceApprovedProfiles,
  deviceProfiles,
  devices,
  isUniqueViolation,
  nowIso,
  sameTarget,
} from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import {
  canUseDeviceProfile,
  endDeviceSessions,
  listStaffAdmittedTo,
  sessions,
} from "@waitron/identity";
import { IN_PROGRESS_PAYMENT_STATES, payments } from "@waitron/payments";
import { getDeviceProfile, isSharedDisplay } from "@waitron/layouts";
import type { DeviceKind, FormFactor } from "@waitron/layouts";
import type {
  DeviceKitchenScreen,
  KitchenScreenKind,
  KitchenScreenScope,
  ProfileKitchenScreens,
} from "@waitron/module";
import { settleDevice } from "./device-equipment.js";
import { KITCHEN_SCREEN_KINDS } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";

/** A device's kind is DERIVED from its profile's form factor via `kindOfFormFactor`. */
export type { DeviceKind };

/** A device's name as a manager typed it: trimmed and never blank. Uniqueness is the index's. */
export function requireDeviceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("management.request_invalid", { field: "name" });
  return name;
}

/** `devices_location_label_active_key`, as the table and columns a refusal on it names. */
const DEVICE_NAME_UNIQUE: ConstraintTarget = {
  table: "devices",
  columns: ["location_id", "label"],
};

/** A refusal on {@link DEVICE_NAME_UNIQUE} as `device.name_taken`; any other error unchanged. */
export function mapDeviceNameTaken(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    const target = constraintTarget(error);
    if (target !== undefined && sameTarget(target, DEVICE_NAME_UNIQUE)) {
      return new AppError("device.name_taken", {});
    }
  }
  return error;
}

/** Insert a device on the caller's transaction, refusals mapped by {@link mapDeviceNameTaken}. */
export async function insertDevice(
  tx: Transaction,
  row: typeof devices.$inferInsert,
): Promise<void> {
  try {
    await tx.insert(devices).values(row);
  } catch (error) {
    throw mapDeviceNameTaken(error);
  }
}

/** The receipt, slip and drawer printers a device row has chosen; `null` is Use default. */
interface DevicePrinters {
  receiptPrinterId: string | null;
  paymentSlipPrinterId: string | null;
  cashDrawerPrinterId: string | null;
}

/**
 * Write a device's name and profile, plus any `also` columns, refusals mapped by
 * {@link mapDeviceNameTaken}. When the profile changes or a disabled device comes back, its
 * equipment settles ({@link settleDevice}), taking the profile's free portable defaults; anything
 * else, such as a rename, leaves its choices and holds alone. Returns the printer choices the row
 * now holds.
 */
export async function updateDeviceSettings(
  tx: Transaction,
  device: { id: string },
  settings: {
    label: string;
    profileId: string;
  },
  also: Partial<typeof devices.$inferInsert> = {},
): Promise<DevicePrinters> {
  const [before] = await tx
    .select({ profileId: devices.deviceProfileId, active: devices.active })
    .from(devices)
    .where(eq(devices.id, device.id));
  try {
    await tx
      .update(devices)
      .set({
        ...also,
        label: settings.label,
        deviceProfileId: settings.profileId,
      })
      .where(eq(devices.id, device.id));
  } catch (error) {
    throw mapDeviceNameTaken(error);
  }
  const comingBack = before !== undefined && !before.active && also.active === true;
  if (before?.profileId !== settings.profileId || comingBack) {
    await settleDevice(tx, device.id, { acquire: true });
  }
  const [stored] = await tx
    .select({
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
    })
    .from(devices)
    .where(eq(devices.id, device.id));
  return stored!;
}

/**
 * Each device's approved alternatives, by name, for `deviceId` alone or every device: live profiles
 * of its active profile's form factor, the active one left out. A row whose profile was retired or
 * changed form factor since is kept but not offered.
 */
export async function readApprovedAlternatives(
  tx: Transaction,
  deviceId?: string,
): Promise<Map<string, { id: string; name: string }[]>> {
  const active = alias(deviceProfiles, "active_profile");
  const rows = await tx
    .select({
      deviceId: deviceApprovedProfiles.deviceId,
      id: deviceProfiles.id,
      name: deviceProfiles.name,
    })
    .from(deviceApprovedProfiles)
    .innerJoin(devices, eq(devices.id, deviceApprovedProfiles.deviceId))
    .innerJoin(active, eq(active.id, devices.deviceProfileId))
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, deviceApprovedProfiles.deviceProfileId))
    .where(
      and(
        deviceId === undefined ? undefined : eq(deviceApprovedProfiles.deviceId, deviceId),
        ne(deviceProfiles.id, devices.deviceProfileId),
        isNull(deviceProfiles.retiredAt),
        eq(deviceProfiles.formFactor, active.formFactor),
      ),
    )
    .orderBy(asc(deviceProfiles.name), asc(deviceProfiles.id));
  const byDevice = new Map<string, { id: string; name: string }[]>();
  for (const { deviceId, ...profile } of rows) {
    const list = byDevice.get(deviceId) ?? [];
    list.push(profile);
    byDevice.set(deviceId, list);
  }
  return byDevice;
}

/** The device's active profile and its approved alternatives, by name; empty for an unknown device. */
export async function readApprovedProfiles(
  tx: Transaction,
  deviceId: string,
): Promise<{ id: string; name: string }[]> {
  const [current] = await tx
    .select({ id: deviceProfiles.id, name: deviceProfiles.name })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, deviceId));
  if (current === undefined) return [];
  return [current, ...((await readApprovedAlternatives(tx, deviceId)).get(deviceId) ?? [])];
}

/**
 * Make `ids` the device's approved alternatives, replacing those stored. Its active profile stays
 * approved whether or not `ids` names it. Each must be a live profile of the active profile's form
 * factor.
 */
export async function approveDeviceProfiles(
  tx: Transaction,
  deviceId: string,
  ids: readonly string[],
): Promise<void> {
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId, formFactor: deviceProfiles.formFactor })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, deviceId));
  if (device === undefined) throw new AppError("device.not_found", { deviceId });
  const alternatives = [...new Set(ids)].filter((id) => id !== device.profileId);
  for (const id of alternatives) {
    const profile = await getDeviceProfile(tx, id);
    if (profile === undefined)
      throw new AppError("device_profile.not_found", { field: "approvedProfileIds" });
    if (profile.formFactor !== device.formFactor)
      throw new AppError("device_profile.incompatible", { field: "approvedProfileIds" });
  }
  await tx.delete(deviceApprovedProfiles).where(eq(deviceApprovedProfiles.deviceId, deviceId));
  if (alternatives.length > 0)
    await tx
      .insert(deviceApprovedProfiles)
      .values(alternatives.map((deviceProfileId) => ({ deviceId, deviceProfileId })));
}

/**
 * After a device's active profile moved from `from` to `to`: `from` stays approved as an
 * alternative, and `to`, approved by being active, needs no row.
 */
export async function keepApprovedAfterSwitch(
  tx: Transaction,
  deviceId: string,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return;
  await tx
    .insert(deviceApprovedProfiles)
    .values({ deviceId, deviceProfileId: from })
    .onConflictDoNothing({
      target: [deviceApprovedProfiles.deviceId, deviceApprovedProfiles.deviceProfileId],
    });
  await tx
    .delete(deviceApprovedProfiles)
    .where(
      and(
        eq(deviceApprovedProfiles.deviceId, deviceId),
        eq(deviceApprovedProfiles.deviceProfileId, to),
      ),
    );
}

/**
 * Refuses `device.payment_in_progress` while a payment the device started still waits on its
 * provider: `attempting` until the provider answers, `initiated` until a hosted payment is paid or
 * expires. A capture not yet filed is not counted: the provider has already answered the device.
 */
export async function assertNoPaymentInProgress(tx: Transaction, deviceId: string): Promise<void> {
  const [found] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(eq(payments.deviceId, deviceId), inArray(payments.state, IN_PROGRESS_PAYMENT_STATES)),
    )
    .limit(1);
  if (found !== undefined) throw new AppError("device.payment_in_progress", {});
}

/**
 * Ends each open session on the device whose person `profileId` does not admit; every one when
 * `profileId` is a shared display, which nobody signs in on whatever its admission list says.
 */
export async function endSessionsNotAdmitted(
  tx: Transaction,
  deviceId: string,
  profileId: string,
): Promise<void> {
  const profile = await getDeviceProfile(tx, profileId);
  if (profile !== undefined && isSharedDisplay(profile.formFactor)) {
    await endDeviceSessions(tx, deviceId);
    return;
  }
  const open = await tx
    .select({ id: sessions.id, personId: sessions.personId })
    .from(sessions)
    .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.endedAt)));
  if (open.length === 0) return;
  const admitted = new Set(
    (await listStaffAdmittedTo(tx, profileId)).map((person) => person.personId),
  );
  const ended = open.filter((session) => !admitted.has(session.personId)).map((s) => s.id);
  if (ended.length > 0)
    await tx.update(sessions).set({ endedAt: nowIso() }).where(inArray(sessions.id, ended));
}

/**
 * Switch the device's active profile to `profileId` for the person signed in on `sessionId`: one
 * the device is approved for and the person may sign in on, with no payment of the device's in
 * progress. The device's kitchen screens narrow to what the new profile offers, recording what they
 * lost. Its equipment settles through
 * {@link updateDeviceSettings}; the sessions of people the new profile does not admit end, every
 * one when it is a shared display. Choosing the active profile changes nothing.
 */
export async function switchActiveProfile(
  tx: Transaction,
  input: { deviceId: string; sessionId: string; personId: string; profileId: string },
): Promise<{ activeProfileId: string }> {
  const [device] = await tx
    .select({
      id: devices.id,
      active: devices.active,
      label: devices.label,
      deviceProfileId: devices.deviceProfileId,
      locationId: devices.locationId,
    })
    .from(devices)
    .where(eq(devices.id, input.deviceId));
  if (device === undefined || !device.active) throw new AppError("device.unauthorized", {});
  const [session] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, input.sessionId), isNull(sessions.endedAt)));
  if (session === undefined) throw new AppError("session.required", {});
  if (input.profileId === device.deviceProfileId)
    return { activeProfileId: device.deviceProfileId };
  const alternatives = (await readApprovedAlternatives(tx, device.id)).get(device.id) ?? [];
  if (!alternatives.some((profile) => profile.id === input.profileId))
    throw new AppError("device_profile.not_approved", {});
  if (!(await canUseDeviceProfile(tx, input.profileId, input.personId)))
    throw new AppError("device_profile.not_admitted", {});
  await assertNoPaymentInProgress(tx, device.id);
  // Before the move is written: the narrowing reads the current profile as what the device had.
  await VENUE_SERVICE.narrowDeviceKitchenScreens(
    tx,
    { locationId: brandLocationId(device.locationId) },
    device.id,
    input.profileId,
  );
  await updateDeviceSettings(tx, device, { label: device.label, profileId: input.profileId });
  await keepApprovedAfterSwitch(tx, device.id, device.deviceProfileId, input.profileId);
  await endSessionsNotAdmitted(tx, device.id, input.profileId);
  return { activeProfileId: input.profileId };
}

/**
 * The profile a manager chose for a device. One that names no profile — unknown, or deleted
 * meanwhile — is a client-recoverable refusal, not a server fault.
 */
export async function requireDeviceProfile(
  tx: Transaction,
  profileId: string,
): Promise<{ formFactor: FormFactor }> {
  const profile = await getDeviceProfile(tx, profileId);
  if (profile === undefined) throw new AppError("device_profile.not_found", {});
  return profile;
}

const KITCHEN_SCREENS_FIELD = "kitchenScreens";

function screenIds(list: unknown): string[] | null {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list))
    throw new AppError("management.request_invalid", { field: KITCHEN_SCREENS_FIELD });
  return list.map((id: unknown) => requireBodyUuid(id, KITCHEN_SCREENS_FIELD));
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
}

/** A request's `kitchenScreens`: absent stays absent; anything else must be a list of screens. */
export function parseKitchenScreens(value: unknown): DeviceKitchenScreen[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw new AppError("management.request_invalid", { field: KITCHEN_SCREENS_FIELD });
  return value.map((entry: unknown) => {
    const screen = asRecord(entry);
    if (!KITCHEN_SCREEN_KINDS.includes(screen.kind as KitchenScreenKind))
      throw new AppError("management.request_invalid", { field: KITCHEN_SCREENS_FIELD });
    return {
      kind: screen.kind as KitchenScreenKind,
      stationIds: screenIds(screen.stationIds),
      zoneIds: screenIds(screen.zoneIds),
    };
  });
}

/** A profile request's `kitchenScreens`: absent stays absent; anything else must map each offered
 * kind to its lists. */
export function parseProfileKitchenScreens(value: unknown): ProfileKitchenScreens | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new AppError("management.request_invalid", { field: KITCHEN_SCREENS_FIELD });
  const screens: Partial<Record<KitchenScreenKind, KitchenScreenScope>> = {};
  for (const [kind, scope] of Object.entries(value)) {
    if (
      !KITCHEN_SCREEN_KINDS.includes(kind as KitchenScreenKind) ||
      typeof scope !== "object" ||
      scope === null
    )
      throw new AppError("management.request_invalid", { field: KITCHEN_SCREENS_FIELD });
    const lists = asRecord(scope);
    screens[kind as KitchenScreenKind] = {
      stationIds: screenIds(lists.stationIds),
      zoneIds: screenIds(lists.zoneIds),
    };
  }
  return screens;
}

/**
 * Checks the kitchen screens a device on this profile is given, writing nothing; `deviceId` names a
 * device whose stored, since switched-off stations and zones it may keep.
 */
export async function resolveDeviceKitchenScreens(
  tx: Transaction,
  cfg: TillConfig,
  input: {
    profileId: string;
    kitchenScreens?: readonly DeviceKitchenScreen[];
    deviceId?: string;
  },
): Promise<{
  kitchenScreens: readonly DeviceKitchenScreen[];
  formFactor: FormFactor;
}> {
  const profile = await requireDeviceProfile(tx, input.profileId);
  const kitchenScreens = input.kitchenScreens ?? [];
  await VENUE_SERVICE.assertDeviceKitchenScreens(
    tx,
    cfg,
    input.profileId,
    kitchenScreens,
    input.deviceId,
  );
  return { kitchenScreens, formFactor: profile.formFactor };
}
