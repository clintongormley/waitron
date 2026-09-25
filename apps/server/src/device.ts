// Side-effect only: keeps the `device.*` codes (errors.ts) reachable from the file that throws them.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { constraintTarget, isUniqueViolation, printers, sameTarget, tills } from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { getDeviceProfile, kindOfFormFactor } from "@waitron/layouts";
import type { DeviceKind, FormFactor } from "@waitron/layouts";
import { requireLiveStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";

/** A device's kind is DERIVED from its profile's form factor via {@link kindOfFormFactor}. */
export type { DeviceKind };

/**
 * Refuse a device binding whose target names no row, as `device.binding_invalid` naming the input
 * FIELD — a reassign to an unknown profile (`deviceProfileId`, the assign-device-profile route) or
 * a hardware PATCH naming an unknown printer (`receiptPrinterId`).
 *
 * Asked BEFORE the write rather than read off the refusal afterwards. The engine's foreign-key
 * refusal is the whole message `FOREIGN KEY constraint failed` — no table, no column, no
 * constraint name (`packages/db/src/constraint-target.ts` states this), and `devices` carries a
 * station FK, a till FK and a location FK beside the two binding ones, so a refusal cannot be
 * attributed to any of the five.
 *
 * `devices_device_profile_fk` and `devices_receipt_printer_fk` are what makes a dangling binding
 * impossible; this check only decides what the operator is TOLD.
 *
 * A `null` target CLEARS the binding and names no row, so it is accepted without a read. Both
 * lookups run on the CALLER's transaction, which is also the write's, and
 * `packages/store/src/write-queue.ts` admits one write transaction at a time — so a row cannot be
 * deleted between the check and the statement. A second process on the same file is outside that
 * and would get the raw refusal.
 */
export async function requireDeviceBinding(
  tx: Transaction,
  binding: { deviceProfileId: string } | { receiptPrinterId: string | null },
): Promise<void> {
  if ("deviceProfileId" in binding) {
    const profile = await getDeviceProfile(tx, binding.deviceProfileId);
    if (profile === undefined) {
      throw new AppError("device.binding_invalid", { field: "deviceProfileId" });
    }
    return;
  }
  if (binding.receiptPrinterId === null) return;
  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(eq(printers.id, binding.receiptPrinterId))
    .limit(1);
  if (printer === undefined) {
    throw new AppError("device.binding_invalid", { field: "receiptPrinterId" });
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
  input: { profileId: string; name: string; stationId?: string | null; registerId?: string | null },
): Promise<{ stationId: string | null; tillId: string | null; formFactor: FormFactor }> {
  const profile = await getDeviceProfile(tx, input.profileId);
  // `profileId` is the admin's choice in the accept dialog, so one that names no profile — unknown,
  // or deleted meanwhile — is a client-recoverable refusal, not a server fault.
  if (profile === undefined) throw new AppError("device_profile.not_found", {});

  // A kds device carries `station_id`, every other form factor `till_id`;
  // `device_binding_rule_insert / _update` (`packages/db/drizzle/0001_behavioural_triggers.sql`)
  // refuses any other shape.
  let stationId: string | null = null;
  let tillId: string | null = null;
  switch (kindOfFormFactor(profile.formFactor)) {
    case "kds_station":
      if (input.stationId == null) throw new AppError("device.station_required", {});
      await requireLiveStation(tx, cfg, input.stationId);
      stationId = input.stationId;
      break;
    case "till":
      tillId = await createRegister(tx, locationId, input.name);
      break;
    case "handheld":
      if (input.registerId == null) throw new AppError("device.register_required", {});
      tillId = await requireLiveRegister(tx, cfg, locationId, input.registerId);
      break;
  }
  return { stationId, tillId, formFactor: profile.formFactor };
}
