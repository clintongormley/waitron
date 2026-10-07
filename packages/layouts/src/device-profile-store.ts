import "./errors.js";
import {
  FOREIGN_KEY_VIOLATION,
  FORM_FACTOR_REFUSAL,
  constraintTarget,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  isRefusal,
  isUniqueViolation,
  nowIso,
  restrictRefused,
  sameTarget,
  triggerRaised,
} from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { NAVIGATION_SCREENS } from "./canvas.js";
import type { CapabilityFlag, FormFactor, NavigationScreen } from "./canvas.js";
import {
  validateCapabilities,
  validateInactivityTimeout,
  validateStartingScreen,
} from "./device-profile.js";
import {
  emptyPrinterLists,
  foldPrinterLists,
  readProfilePrinterLists,
  setProfilePrinterLists,
  type ProfilePrinterLists,
} from "./device-printers.js";

/** `canvasId` is `null` when the profile falls back to its form factor's canvas. */
export type DeviceProfileSettings = {
  id: string;
  name: string;
  formFactor: FormFactor;
  canvasId: string | null;
  capabilities: CapabilityFlag[];
  /** The auto-logout idle timeout in seconds; `null` means never. */
  inactivityTimeoutSeconds: number | null;
  /** `null` leaves the till on its canvas's first view. */
  startingScreen: NavigationScreen | null;
};

export type DeviceProfileRow = DeviceProfileSettings & ProfilePrinterLists;

const PROFILE_COLUMNS = {
  id: deviceProfiles.id,
  name: deviceProfiles.name,
  formFactor: deviceProfiles.formFactor,
  canvasId: deviceProfiles.canvasId,
  capabilities: deviceProfiles.capabilities,
  inactivityTimeoutSeconds: deviceProfiles.inactivityTimeoutSeconds,
  startingScreen: deviceProfiles.startingScreen,
} as const;

type StoredProfile = {
  id: string;
  name: string;
  formFactor: FormFactor;
  canvasId: string | null;
  capabilities: unknown;
  inactivityTimeoutSeconds: number | null;
  startingScreen: string | null;
};

/**
 * The `as` cast restores a type the JSON column does not carry: this package depends on
 * `@waitron/db`, so the column cannot name one of its types without a dependency cycle.
 */
function toSettings(row: StoredProfile): DeviceProfileSettings {
  return {
    id: row.id,
    name: row.name,
    formFactor: row.formFactor,
    canvasId: row.canvasId,
    capabilities: row.capabilities as CapabilityFlag[],
    inactivityTimeoutSeconds: row.inactivityTimeoutSeconds,
    startingScreen: knownScreen(row.startingScreen),
  };
}

/** The column has no CHECK, so a value not written through this store is read as none. */
function knownScreen(stored: string | null): NavigationScreen | null {
  return (NAVIGATION_SCREENS as readonly (string | null)[]).includes(stored)
    ? (stored as NavigationScreen)
    : null;
}

function toRow(row: StoredProfile, lists: ProfilePrinterLists): DeviceProfileRow {
  return { ...toSettings(row), ...lists };
}

const live = isNull(deviceProfiles.retiredAt);

const PROFILE_NAME: ConstraintTarget = { table: "device_profiles", columns: ["name"] };

/**
 * Translates the refusals these writes can raise into domain codes and re-throws anything else.
 *
 * A unique violation that names no key is still `device_profile.name_taken`, for the reason
 * canvas-store.ts's `translateWriteError` gives.
 *
 * SQLite names no key in a foreign-key refusal, only its direction: 787 for a written value naming
 * no parent, 1811 for a delete a RESTRICT key refused. So the two foreign-key branches cannot tell
 * which key refused. That is sound only while each writer's `try` wraps ONE statement on
 * `device_profiles`, `canvas_id` is the only key out of it, and every key into it that can refuse a
 * delete is RESTRICT (a no-action key's refusal is 787, and would read as `bad_canvas_ref`) —
 * pinned by `has ONE key out of device_profiles and ONE key into it that can refuse`
 * (device-profile-store.db.test.ts), which migrates core and identity only. `deleteDeviceProfile` deletes only a profile no device row names,
 * so a RESTRICT refusal there comes from some other key into the table and is still
 * `device_profile.in_use` (`translates a refusal by a key the device check does not read`, same
 * file). `device_profile_printers.device_profile_id` also keys into it and cascades, so it does not
 * refuse a delete (`deletes a profile's list rows with the profile, and refuses deleting a listed
 * printer`, device-printers.db.test.ts).
 * `setProfilePrinterLists` runs after the `try`, so its refusals are never translated here. Widen a
 * `try` to a second statement and its foreign-key refusals would be translated as this table's.
 *
 * Exported for device-profile-store.test.ts, not from the package barrel.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const target = constraintTarget(err);
    if (target === undefined || sameTarget(target, PROFILE_NAME)) {
      throw new AppError("device_profile.name_taken", {});
    }
  }
  if (isRefusal(err, FOREIGN_KEY_VIOLATION)) {
    throw new AppError("device_profile.invalid", { reason: "bad_canvas_ref" });
  }
  if (restrictRefused(err) || triggerRaised(err, FORM_FACTOR_REFUSAL)) {
    throw new AppError("device_profile.in_use", {});
  }
  throw err;
}

export async function listDeviceProfiles(tx: Transaction): Promise<DeviceProfileRow[]> {
  const rows = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .where(live)
    .orderBy(asc(deviceProfiles.name));
  const listed = await tx
    .select({
      profileId: deviceProfilePrinters.deviceProfileId,
      printerId: deviceProfilePrinters.printerId,
      role: deviceProfilePrinters.role,
      isDefault: deviceProfilePrinters.isDefault,
    })
    .from(deviceProfilePrinters)
    .orderBy(asc(deviceProfilePrinters.position));
  const byProfile = new Map<string, typeof listed>();
  for (const row of listed) {
    const group = byProfile.get(row.profileId);
    if (group === undefined) byProfile.set(row.profileId, [row]);
    else group.push(row);
  }
  return rows.map((row) => toRow(row, foldPrinterLists(byProfile.get(row.id) ?? [])));
}

/** The profile without its printer lists; {@link getDeviceProfileWithPrinters} reads those too. */
export async function getDeviceProfile(
  tx: Transaction,
  id: string,
): Promise<DeviceProfileSettings | undefined> {
  const [row] = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, id), live));
  return row === undefined ? undefined : toSettings(row);
}

export async function getDeviceProfileWithPrinters(
  tx: Transaction,
  id: string,
): Promise<DeviceProfileRow | undefined> {
  const settings = await getDeviceProfile(tx, id);
  if (settings === undefined) return undefined;
  return { ...settings, ...(await readProfilePrinterLists(tx, id)) };
}

/** `null` when the profile has none, or is retired or absent. */
export async function readProfileStartingScreen(
  tx: Transaction,
  id: string,
): Promise<NavigationScreen | null> {
  const [row] = await tx
    .select({ startingScreen: deviceProfiles.startingScreen })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, id), live));
  return knownScreen(row?.startingScreen ?? null);
}

export async function createDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    name: string;
    formFactor: FormFactor;
    canvasId: string | null | undefined;
    capabilities: unknown;
    inactivityTimeoutSeconds?: number | null;
    /** Absent means none. */
    startingScreen?: unknown;
    /** Absent means every list empty and no defaults. */
    printerLists?: ProfilePrinterLists;
  },
): Promise<DeviceProfileRow> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const capabilities = validateCapabilities(input.capabilities, input.formFactor);
  const startingScreen = validateStartingScreen(input.startingScreen ?? null, capabilities);
  const inactivityTimeoutSeconds = validateInactivityTimeout(
    input.inactivityTimeoutSeconds ?? null,
    input.formFactor,
  );
  let created: StoredProfile;
  try {
    const [row] = await tx
      .insert(deviceProfiles)
      .values({
        name: input.name,
        formFactor: input.formFactor,
        canvasId: input.canvasId ?? null,
        capabilities,
        inactivityTimeoutSeconds,
        startingScreen,
      })
      .returning(PROFILE_COLUMNS);
    created = row!;
  } catch (error) {
    translateWriteError(error);
  }
  const lists = input.printerLists ?? emptyPrinterLists();
  await setProfilePrinterLists(tx, created.id, lists);
  return toRow(created, lists);
}

export async function updateDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    id: string;
    name: string;
    formFactor: FormFactor;
    canvasId: string | null | undefined;
    capabilities: unknown;
    inactivityTimeoutSeconds?: number | null;
    /** Absent keeps the stored one, which must still be a screen the new capabilities show. */
    startingScreen?: unknown;
    /** Absent leaves every list and default as it is. */
    printerLists?: ProfilePrinterLists;
  },
): Promise<DeviceProfileRow> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const capabilities = validateCapabilities(input.capabilities, input.formFactor);
  const startingScreen = validateStartingScreen(
    input.startingScreen === undefined
      ? await readProfileStartingScreen(tx, input.id)
      : input.startingScreen,
    capabilities,
  );
  const inactivityTimeoutSeconds = validateInactivityTimeout(
    input.inactivityTimeoutSeconds ?? null,
    input.formFactor,
  );
  let updated: StoredProfile[];
  try {
    const rows = await tx
      .update(deviceProfiles)
      .set({
        name: input.name,
        formFactor: input.formFactor,
        canvasId: input.canvasId ?? null,
        capabilities,
        inactivityTimeoutSeconds,
        startingScreen,
        updatedAt: nowIso(),
      })
      .where(and(eq(deviceProfiles.id, input.id), live))
      .returning(PROFILE_COLUMNS);
    updated = rows;
  } catch (error) {
    translateWriteError(error);
  }
  if (updated.length === 0) {
    throw new AppError("device_profile.not_found", {});
  }
  if (input.printerLists !== undefined) {
    await setProfilePrinterLists(tx, input.id, input.printerLists);
  }
  return toRow(updated[0]!, await readProfilePrinterLists(tx, input.id));
}

/**
 * Refused `device_profile.in_use` while an active device holds the profile. One that only disabled
 * devices hold is retired rather than deleted, because their `device_profile_id` keys refuse the
 * delete.
 */
export async function deleteDeviceProfile(
  tx: Transaction,
  input: { managementSessionId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const [profile] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, input.id), live));
  if (profile === undefined) {
    throw new AppError("device_profile.not_found", {});
  }
  const holders = await tx
    .select({ active: devices.active })
    .from(devices)
    .where(eq(devices.deviceProfileId, input.id));
  if (holders.some((device) => device.active)) {
    throw new AppError("device_profile.in_use", {});
  }
  if (holders.length > 0) {
    const now = nowIso();
    await tx
      .update(deviceProfiles)
      .set({ retiredAt: now, updatedAt: now, canvasId: null })
      .where(eq(deviceProfiles.id, input.id));
    await tx
      .delete(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, input.id));
    return;
  }
  try {
    await tx.delete(deviceProfiles).where(eq(deviceProfiles.id, input.id));
  } catch (error) {
    translateWriteError(error);
  }
}
