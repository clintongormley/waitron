import "./errors.js";
import {
  FOREIGN_KEY_VIOLATION,
  RESTRICT_VIOLATION,
  constraintTarget,
  deviceProfiles,
  isRefusal,
  isUniqueViolation,
  nowIso,
  sameTarget,
} from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { asc, eq } from "drizzle-orm";
import type { CapabilityFlag, FormFactor } from "./canvas.js";
import { validateCapabilities, validateInactivityTimeout } from "./device-profile.js";

/** `canvasId` is `null` when the profile falls back to its form factor's canvas. */
export type DeviceProfileRow = {
  id: string;
  name: string;
  formFactor: FormFactor;
  canvasId: string | null;
  capabilities: CapabilityFlag[];
  /** The auto-logout idle timeout in seconds; `null` means never. */
  inactivityTimeoutSeconds: number | null;
};

const PROFILE_COLUMNS = {
  id: deviceProfiles.id,
  name: deviceProfiles.name,
  formFactor: deviceProfiles.formFactor,
  canvasId: deviceProfiles.canvasId,
  capabilities: deviceProfiles.capabilities,
  inactivityTimeoutSeconds: deviceProfiles.inactivityTimeoutSeconds,
} as const;

/**
 * The `as` cast restores a type the JSON column does not carry: this package depends on
 * `@waitron/db`, so the column cannot name one of its types without a dependency cycle.
 */
function toRow(row: {
  id: string;
  name: string;
  formFactor: FormFactor;
  canvasId: string | null;
  capabilities: unknown;
  inactivityTimeoutSeconds: number | null;
}): DeviceProfileRow {
  return {
    id: row.id,
    name: row.name,
    formFactor: row.formFactor,
    canvasId: row.canvasId,
    capabilities: row.capabilities as CapabilityFlag[],
    inactivityTimeoutSeconds: row.inactivityTimeoutSeconds,
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
 * no parent, 1811 for a delete a RESTRICT key refused. So the two foreign-key branches ask only the
 * class. That is sound only while each writer's `try` wraps ONE statement on `device_profiles`,
 * `canvas_id` is the only key out of it and `devices.device_profile_id` the only key into it — the
 * schema half is pinned by `has ONE key out of device_profiles and ONE key into it`
 * (device-profile-store.db.test.ts). Widen a `try` to a second statement and its foreign-key
 * (787) and 1811 refusals would be translated as this table's, with nothing to catch it.
 *
 * 1811 is also every trigger's `RAISE(ABORT)`, so `device_profile_form_factor_locked` refusing an
 * update arrives here as `device_profile.in_use` too (docs/backlog.md: "`RESTRICT_VIOLATION` and
 * `TRIGGER_ABORT` are the same number").
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
  if (isRefusal(err, RESTRICT_VIOLATION)) {
    throw new AppError("device_profile.in_use", {});
  }
  throw err;
}

export async function listDeviceProfiles(tx: Transaction): Promise<DeviceProfileRow[]> {
  const rows = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .orderBy(asc(deviceProfiles.name));
  return rows.map(toRow);
}

export async function getDeviceProfile(
  tx: Transaction,
  id: string,
): Promise<DeviceProfileRow | undefined> {
  const [row] = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, id));
  if (row === undefined) return undefined;
  return toRow(row);
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
    return toRow(row!);
  } catch (error) {
    translateWriteError(error);
  }
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
  let updated: DeviceProfileRow[];
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
    updated = rows.map(toRow);
  } catch (error) {
    translateWriteError(error);
  }
  if (updated.length === 0) {
    throw new AppError("device_profile.not_found", {});
  }
  return updated[0]!;
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
