// Side-effect only: keeps this host's `device.*`/`station.*` codes (errors.ts) reachable from the file
// that throws them — the reachability convention kitchen.ts/till-sale.ts follow. See errors.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  isUniqueViolation,
  pgErrorConstraint,
  tills,
  uniqueViolationConstraint,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { getDeviceProfile, kindOfFormFactor } from "@waitron/layouts";
import type { DeviceKind, FormFactor } from "@waitron/layouts";
import { requireLiveStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";

// The binding rules a device carries, and the two error translations the device write paths need.
// `resolveDeviceBinding` is the shared body of ACCEPT (`join-requests.ts`): the profile decides the
// form factor, the form factor decides whether the device binds a kitchen station or a register, and a
// counter till's register is created here because nothing else in the flow knows to.

/** The kind of device an enrolment produces — re-exported from `@waitron/layouts`, which owns the
 * type now that the `device_kind` pgEnum is gone (a device's kind is DERIVED from its profile's form
 * factor via {@link kindOfFormFactor}). Three kinds are wired end-to-end (join, accept, session,
 * firewall): a `kds_station` (an always-on kitchen screen, station-bound), a `handheld` (a roving,
 * station-less waiter phone that takes/fires tableside orders and settles sales at the table for cash
 * or a MANUAL card tender — the datáfono leg, no integrated reader — fenced from the INTEGRATED card
 * reader (`/api/pay`) and the other fiscal/cash routes: reprint, drawer-open, place, collect, cancel),
 * and a `till`. The authoritative fenced/allowed surface is the till-api firewall, `assertNotHandheld`
 * in device-session.ts and the FENCED/ALLOWED table atop till-api.ts. */
export type { DeviceKind };

/** The pg SQLSTATE for a foreign-key violation, as `@waitron/printing`'s `printers.ts` and
 * `tables.ts`'s `isZoneFkViolation` name it. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * A device composite binding FK and the input FIELD it guards. A 23503 on one of these means a device
 * write (enrol, `assign-device-profile`, or the hardware PATCH) named a binding that no row of this
 * tenant matches — the composite makes each check tenant-isolated and atomic with the write (no
 * read-then-write race), so the routes translate it here rather than pre-checking:
 *  - `devices_device_profile_fk (tenant_id, device_profile_id)` — a reassign to an unknown/foreign
 *    profile (`deviceProfileId`);
 *  - `devices_receipt_printer_fk (tenant_id, receipt_printer_id)` — a hardware PATCH naming an
 *    unknown/foreign printer (`receiptPrinterId`).
 * Only `devices` carries a binding FK: a join request names none, so nothing at knock time can trip one.
 */
const BINDING_FK_FIELD: Record<string, "deviceProfileId" | "receiptPrinterId"> = {
  devices_device_profile_fk: "deviceProfileId",
  devices_receipt_printer_fk: "receiptPrinterId",
};

/**
 * If `error` (or anything it wraps) is a 23503 on one of the device binding composite FKs, the input
 * FIELD it guards (`deviceProfileId`/`receiptPrinterId`); otherwise `undefined`. Reuses `@waitron/db`'s
 * `pgErrorConstraint` to walk the cause chain and read the offending constraint name — Drizzle wraps
 * every failed query in a `DrizzleQueryError` whose own `.code` is undefined, so the real SQLSTATE and
 * `.constraint` name live on `.cause` (node-postgres), one level deeper still under PGlite — then maps
 * that name through {@link BINDING_FK_FIELD}. It keys on the CONSTRAINT NAME, not merely the 23503
 * code, so a 23503 on a DIFFERENT constraint (the tenant/location direct FKs) — or one whose driver
 * reported no constraint name — returns `undefined` and is rethrown raw rather than mislabelled
 * `device.binding_invalid`. The `isZoneFkViolation` idiom (`tables.ts`). Exported for the crafted-error
 * unit tests, NOT from a package barrel (this is an application, not a library).
 */
export function bindingFkField(error: unknown): "deviceProfileId" | "receiptPrinterId" | undefined {
  const constraint = pgErrorConstraint(error, FOREIGN_KEY_VIOLATION);
  return constraint === undefined ? undefined : BINDING_FK_FIELD[constraint];
}

/** The UNIQUE index that makes a duplicate register name at one venue unrepresentable
 * (`tills_tenant_location_name_key`, migration 0006). {@link createRegister} keys its 23505
 * translation on this name so an unrelated unique violation is rethrown raw, not mislabelled. */
const TILL_NAME_UNIQUE = "tills_tenant_location_name_key";

/**
 * Auto-create the cash register a `till`-form-factor device rings against, named after the device, and
 * return its id. Runs on the caller's transaction (never its own), so the enclosing enrolment's throw —
 * including this function's own — discards the register with the device (no orphan till, CLAUDE.md §3).
 * A name already used at this venue trips {@link TILL_NAME_UNIQUE} (23505) → `device.register_name_taken`
 * (the operator renames the device rather than ending up with two indistinguishable registers); the
 * unique index is the whole guard (`tills` is a `state` table), keyed by CONSTRAINT NAME so an unrelated
 * unique violation is rethrown raw — the `translateWriteError` idiom (device-profile-store.ts).
 */
async function createRegister(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  name: string,
): Promise<string> {
  try {
    const [till] = await tx
      .insert(tills)
      .values({ tenantId: cfg.tenantId, locationId, name })
      .returning({ id: tills.id });
    return till!.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const constraint = uniqueViolationConstraint(error);
      // PGlite may report no constraint name; the only unique this narrow insert can trip is the
      // venue-scoped name index, so a nameless 23505 here is that one (the `translateWriteError` fallback).
      if (constraint === undefined || constraint === TILL_NAME_UNIQUE) {
        throw new AppError("device.register_name_taken", {});
      }
    }
    throw error;
  }
}

/**
 * Assert `registerId` names a `tills` row of THIS tenant at THIS venue and return it. A by-id read that
 * carries its OWN `tenant_id` predicate — one-tenant-per-db is NOT the query's isolation boundary
 * (CLAUDE.md §3) — plus the `location_id` scope, so a register that is absent, another tenant's, or
 * another venue's is rejected here rather than trusted or left to the `devices` composite FK (which
 * sees neither location). No such row → `device.binding_invalid` naming the `tillId` FIELD (never the
 * id), the code the domain already uses for "named a binding id that matches no row of this tenant".
 */
async function requireLiveRegister(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  registerId: string,
): Promise<string> {
  const [till] = await tx
    .select({ id: tills.id })
    .from(tills)
    .where(
      and(
        eq(tills.tenantId, cfg.tenantId),
        eq(tills.locationId, locationId),
        eq(tills.id, registerId),
      ),
    );
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
  const profile = await getDeviceProfile(tx, cfg.tenantId, input.profileId);
  // `profileId` is the admin's choice in the accept dialog, so a well-formed id that names no profile
  // of this tenant —
  // unknown, or one deleted meanwhile — is a CLIENT-recoverable 404, NOT a server fault: reuse
  // `device_profile.not_found` (the device-profile store's own "that profile isn't here" code, empty
  // params) rather than the opaque 500 a `device.profile_missing` would have paged as.
  if (profile === undefined) throw new AppError("device_profile.not_found", {});

  // The station/register binding this device carries, derived from its profile's form factor — the
  // one column NON-NULL for a kds device is `station_id`, for every other form factor `till_id`, and
  // `device_binding_rule_insert / _update` (migration 0004) is the DB backstop that refuses any other shape.
  let stationId: string | null = null;
  let tillId: string | null = null;
  switch (kindOfFormFactor(profile.formFactor)) {
    case "kds_station":
      if (input.stationId == null) throw new AppError("device.station_required", {});
      await requireLiveStation(tx, cfg, input.stationId);
      stationId = input.stationId;
      break;
    case "till":
      tillId = await createRegister(tx, cfg, locationId, input.name);
      break;
    case "handheld":
      if (input.registerId == null) throw new AppError("device.register_required", {});
      tillId = await requireLiveRegister(tx, cfg, locationId, input.registerId);
      break;
  }
  return { stationId, tillId, formFactor: profile.formFactor };
}
