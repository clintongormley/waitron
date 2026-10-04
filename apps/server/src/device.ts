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

/**
 * Refuse a reassign to a profile that names no row as `device.binding_invalid` naming the input
 * FIELD (`deviceProfileId`, the assign-device-profile route).
 *
 * Asked BEFORE the write rather than read off the refusal afterwards. The engine's foreign-key
 * refusal is the whole message `FOREIGN KEY constraint failed` — no table, no column, no
 * constraint name (`packages/db/src/constraint-target.ts` states this), and `devices` carries
 * several other foreign keys, so a refusal cannot be attributed to any one of them.
 *
 * The lookup runs on the CALLER's transaction, which is also the write's, and
 * `packages/store/src/write-queue.ts` admits one write transaction at a time — so the profile cannot
 * be deleted between the check and the statement. A second process on the same file is outside
 * that and would get the raw refusal.
 */
export async function requireDeviceBinding(
  tx: Transaction,
  binding: { deviceProfileId: string },
): Promise<void> {
  const profile = await getDeviceProfile(tx, binding.deviceProfileId);
  if (profile === undefined) {
    throw new AppError("device.binding_invalid", { field: "deviceProfileId" });
  }
}

/** `devices_location_label_active_key`, as the table and columns a refusal on it names. */
const DEVICE_NAME_UNIQUE: ConstraintTarget = {
  table: "devices",
  columns: ["location_id", "label"],
};

/**
 * Insert a device on the caller's transaction. A refusal on {@link DEVICE_NAME_UNIQUE}, or one naming
 * no key, becomes `device.name_taken`; any other refusal is rethrown raw.
 */
export async function insertDevice(
  tx: Transaction,
  row: typeof devices.$inferInsert,
): Promise<void> {
  try {
    await tx.insert(devices).values(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const target = constraintTarget(error);
      // `undefined` means a unique index over an EXPRESSION, which names no key
      // (`packages/db/src/constraint-target.ts`).
      if (target === undefined || sameTarget(target, DEVICE_NAME_UNIQUE)) {
        throw new AppError("device.name_taken", {});
      }
    }
    throw error;
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
