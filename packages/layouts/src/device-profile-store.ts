import "./errors.js";
import {
  FOREIGN_KEY_VIOLATION,
  FORM_FACTOR_REFUSAL,
  constraintTarget,
  deviceProfilePrinters,
  deviceProfiles,
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
import { asc, eq } from "drizzle-orm";
import type { CapabilityFlag, FormFactor } from "./canvas.js";
import { validateCapabilities, validateInactivityTimeout } from "./device-profile.js";
import {
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
};

export type DeviceProfileRow = DeviceProfileSettings & ProfilePrinterLists;

const PROFILE_COLUMNS = {
  id: deviceProfiles.id,
  name: deviceProfiles.name,
  formFactor: deviceProfiles.formFactor,
  canvasId: deviceProfiles.canvasId,
  capabilities: deviceProfiles.capabilities,
  inactivityTimeoutSeconds: deviceProfiles.inactivityTimeoutSeconds,
} as const;

type StoredProfile = {
  id: string;
  name: string;
  formFactor: FormFactor;
  canvasId: string | null;
  capabilities: unknown;
  inactivityTimeoutSeconds: number | null;
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
  };
}

function toRow(row: StoredProfile, lists: ProfilePrinterLists): DeviceProfileRow {
  return {
    ...toSettings(row),
    receiptPrinterIds: lists.receiptPrinterIds,
    paymentSlipPrinterIds: lists.paymentSlipPrinterIds,
  };
}

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
 * `device_profiles`, `canvas_id` is the only key out of it and `devices.device_profile_id` the only
 * key into it that can refuse — the schema half is pinned by `has ONE key out of device_profiles
 * and ONE key into it that can refuse` (device-profile-store.db.test.ts), which migrates core and
 * identity only. `device_profile_printers.device_profile_id` and the catalogue's
 * `device_profile_home_layouts.device_profile_id` also key into it and cascade, so neither refuses
 * a delete (the profile-deleted case in `apps/server/src/management-api.device-profiles.test.ts`).
 * `setProfilePrinterLists` runs after the `try`, so its refusals are never translated here. Widen a
 * `try` to a second statement and its foreign-key and RESTRICT refusals would be translated as this
 * table's, with nothing to catch it.
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
    .orderBy(asc(deviceProfiles.name));
  const listed = await tx
    .select({
      profileId: deviceProfilePrinters.deviceProfileId,
      printerId: deviceProfilePrinters.printerId,
      role: deviceProfilePrinters.role,
    })
    .from(deviceProfilePrinters)
    .orderBy(asc(deviceProfilePrinters.position));
  const lists = new Map<string, ProfilePrinterLists>();
  for (const { profileId, printerId, role } of listed) {
    let entry = lists.get(profileId);
    if (entry === undefined) {
      entry = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };
      lists.set(profileId, entry);
    }
    (role === "receipt" ? entry.receiptPrinterIds : entry.paymentSlipPrinterIds).push(printerId);
  }
  return rows.map((row) =>
    toRow(row, lists.get(row.id) ?? { receiptPrinterIds: [], paymentSlipPrinterIds: [] }),
  );
}

/** The profile without its printer lists; {@link getDeviceProfileWithPrinters} reads those too. */
export async function getDeviceProfile(
  tx: Transaction,
  id: string,
): Promise<DeviceProfileSettings | undefined> {
  const [row] = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, id));
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

export async function createDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    name: string;
    formFactor: FormFactor;
    canvasId: string | null | undefined;
    capabilities: unknown;
    inactivityTimeoutSeconds?: number | null;
    /** Absent means both lists empty. */
    printerLists?: ProfilePrinterLists;
  },
): Promise<DeviceProfileRow> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const capabilities = validateCapabilities(input.capabilities);
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
      })
      .returning(PROFILE_COLUMNS);
    created = row!;
  } catch (error) {
    translateWriteError(error);
  }
  const lists = input.printerLists ?? { receiptPrinterIds: [], paymentSlipPrinterIds: [] };
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
    /** Absent leaves both lists as they are. */
    printerLists?: ProfilePrinterLists;
  },
): Promise<DeviceProfileRow> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const capabilities = validateCapabilities(input.capabilities);
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
        updatedAt: nowIso(),
      })
      .where(eq(deviceProfiles.id, input.id))
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

export async function deleteDeviceProfile(
  tx: Transaction,
  input: { managementSessionId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  let deleted: { id: string }[];
  try {
    deleted = await tx
      .delete(deviceProfiles)
      .where(eq(deviceProfiles.id, input.id))
      .returning({ id: deviceProfiles.id });
  } catch (error) {
    translateWriteError(error);
  }
  if (deleted.length === 0) {
    throw new AppError("device_profile.not_found", {});
  }
}
