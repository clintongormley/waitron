// Side-effect only: keeps the `device.*` codes (errors.ts) reachable from the file that throws them.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { constraintTarget, isUniqueViolation, sameTarget, tills } from "@waitron/db";
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

/** `tills_tenant_location_name_key`, as the table and columns a refusal on it names. */
const TILL_NAME_UNIQUE: ConstraintTarget = { table: "tills", columns: ["location_id", "name"] };

/**
 * Runs on the caller's transaction (never its own), so the enclosing enrolment's throw discards the
 * register with the device. A refusal on {@link TILL_NAME_UNIQUE}, or one naming no key, becomes
 * `device.register_name_taken`; any other unique violation is rethrown raw.
 */
async function createRegister(tx: Transaction, locationId: string, name: string): Promise<string> {
  try {
    const [till] = await tx.insert(tills).values({ locationId, name }).returning({ id: tills.id });
    return till!.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const target = constraintTarget(error);
      // `undefined` means a unique index over an EXPRESSION, which names no key
      // (`packages/db/src/constraint-target.ts`).
      if (target === undefined || sameTarget(target, TILL_NAME_UNIQUE)) {
        throw new AppError("device.register_name_taken", {});
      }
    }
    throw error;
  }
}

/**
 * Scoped by `location_id`, so another location's register is refused here; the `devices` FK sees no
 * location.
 */
async function requireLiveRegister(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  registerId: string,
): Promise<string> {
  void cfg;
  const [till] = await tx
    .select({ id: tills.id })
    .from(tills)
    .where(and(eq(tills.locationId, locationId), eq(tills.id, registerId)));
  if (till === undefined) throw new AppError("device.binding_invalid", { field: "tillId" });
  return till.id;
}

/**
 * Resolve which binding a device with this profile must carry, creating the register a counter till
 * owns. The ADMIN supplies the profile and binding, when accepting a join request — never the joining
 * device on an unauthenticated route, which matters because this WRITES (a `till` form factor inserts a
 * `tills` row). Its one caller is `acceptDeviceJoinRequest` (`join-requests.ts`), on that caller's
 * transaction, so a later failure discards the register with the device.
 */
export async function resolveDeviceBinding(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  input: {
    profileId: string;
    name: string;
    stationId?: string | null;
    watcherId?: string | null;
    registerId?: string | null;
  },
): Promise<{
  stationId: string | null;
  watcherId: string | null;
  tillId: string | null;
  formFactor: FormFactor;
}> {
  const profile = await getDeviceProfile(tx, input.profileId);
  // `profileId` is the admin's choice in the accept dialog, so one that names no profile — unknown,
  // or deleted meanwhile — is a client-recoverable refusal, not a server fault.
  if (profile === undefined) throw new AppError("device_profile.not_found", {});

  // A kitchen screen carries one station or watcher; other form factors carry a till.
  let stationId: string | null = null;
  let watcherId: string | null = null;
  let tillId: string | null = null;
  switch (kindOfFormFactor(profile.formFactor)) {
    case "kds_station":
      if (input.stationId != null && input.watcherId != null)
        throw new AppError("management.request_invalid", { field: "watcherId" });
      if (input.stationId == null && input.watcherId == null)
        throw new AppError("device.station_required", {});
      if (input.stationId != null) {
        await requireLiveStation(tx, cfg, input.stationId);
        stationId = input.stationId;
      } else if (input.watcherId != null) {
        const watcher = await readWatcher(tx, cfg, input.watcherId);
        if (!watcher?.active)
          throw new AppError("watcher.not_found", { watcherId: input.watcherId });
        watcherId = input.watcherId;
      }
      break;
    case "till":
      if (input.watcherId != null)
        throw new AppError("management.request_invalid", { field: "watcherId" });
      tillId = await createRegister(tx, locationId, input.name);
      break;
    case "handheld":
      if (input.watcherId != null)
        throw new AppError("management.request_invalid", { field: "watcherId" });
      if (input.registerId == null) throw new AppError("device.register_required", {});
      tillId = await requireLiveRegister(tx, cfg, locationId, input.registerId);
      break;
  }
  return { stationId, watcherId, tillId, formFactor: profile.formFactor };
}
