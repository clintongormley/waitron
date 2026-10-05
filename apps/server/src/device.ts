// Side-effect only: keeps the `device.*` codes (errors.ts) reachable from the file that throws them.
import "./errors.js";
import { AppError } from "@waitron/shared";
import { constraintTarget, devices, isUniqueViolation, sameTarget } from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { getDeviceProfile, kindOfFormFactor } from "@waitron/layouts";
import type { DeviceKind, FormFactor } from "@waitron/layouts";
import { requireLiveStation } from "./kitchen.js";
import { readWatcher } from "./watchers.js";
import type { TillConfig } from "./till-config.js";

/** A device's kind is DERIVED from its profile's form factor via {@link kindOfFormFactor}. */
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

/**
 * Resolve which station or watcher a device with this profile binds. The ADMIN supplies the profile
 * and binding when accepting a join request, never the joining device on an unauthenticated route.
 */
export async function resolveDeviceBinding(
  tx: Transaction,
  cfg: TillConfig,
  input: {
    profileId: string;
    stationId?: string | null;
    watcherId?: string | null;
  },
): Promise<{
  stationId: string | null;
  watcherId: string | null;
  formFactor: FormFactor;
}> {
  const profile = await getDeviceProfile(tx, input.profileId);
  // `profileId` is the admin's choice in the accept dialog, so one that names no profile — unknown,
  // or deleted meanwhile — is a client-recoverable refusal, not a server fault.
  if (profile === undefined) throw new AppError("device_profile.not_found", {});

  // A kitchen screen carries one station or watcher; other form factors carry neither.
  let stationId: string | null = null;
  let watcherId: string | null = null;
  if (kindOfFormFactor(profile.formFactor) === "kds_station") {
    if (input.stationId != null && input.watcherId != null)
      throw new AppError("management.request_invalid", { field: "watcherId" });
    if (input.stationId == null && input.watcherId == null)
      throw new AppError("device.station_required", {});
    if (input.stationId != null) {
      await requireLiveStation(tx, cfg, input.stationId);
      stationId = input.stationId;
    } else if (input.watcherId != null) {
      const watcher = await readWatcher(tx, cfg, input.watcherId);
      if (!watcher?.active) throw new AppError("watcher.not_found", { watcherId: input.watcherId });
      watcherId = input.watcherId;
    }
  } else if (input.watcherId != null) {
    throw new AppError("management.request_invalid", { field: "watcherId" });
  }
  return { stationId, watcherId, formFactor: profile.formFactor };
}
