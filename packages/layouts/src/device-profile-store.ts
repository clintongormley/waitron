import "./errors.js";
import {
  deviceProfiles,
  isUniqueViolation,
  pgErrorConstraint,
  uniqueViolationConstraint,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { CapabilityFlag } from "./canvas.js";
import { validateCapabilities } from "./device-profile.js";

/**
 * The list/get/create/update/delete service over `device_profiles` (design 2026-09-05 §5.1). MANY rows
 * per tenant, keyed by `id`, names unique per tenant. The twin of `canvas-store.ts`, sharing its
 * shape exactly — read that file's header for the (tx, …)-is-caller-scoped convention.
 *
 * Every function takes the caller's transaction, opened with
 * `withTenant(deps.db, tenantId, …)` + `asAppUser(tx)`. Exercised in
 * `device-profile-store.pg.test.ts` (real Postgres, as a non-superuser `app_user` member — PGlite
 * holds every grant, CLAUDE.md §4).
 *
 * The writers run, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateCapabilities` — fail-closed on an
 * unknown capability flag (throws `device_profile.invalid` {reason: "bad_capabilities"} before the
 * write, since capabilities drive the /api/pay + /api/drawer firewall); (3) the drizzle write, whose
 * 23505 on the per-tenant name unique becomes `device_profile.name_taken` and whose 23503 on the
 * tenant-consistent composite FK `device_profiles_canvas_fk` becomes `device_profile.invalid`
 * {reason: "bad_canvas_ref"} (see `translateWriteError`). `deleteDeviceProfile` authorises but has no
 * capabilities to validate. Reads return `capabilities` as PARSED jsonb (an array) — no `::text[]`
 * cast: it is a jsonb column, not PG `name[]` (CLAUDE.md §4's cast note is about `name[]`). The `as`
 * cast re-attaches the `CapabilityFlag[]` shape the plain-jsonb column drops (it is not
 * `.$type<>()`-annotated, to avoid a `@waitron/layouts` → `@waitron/db` circular dependency, see
 * `packages/db/src/schema/device-profiles.ts`).
 */

/** The shape every read and write returns: identity, name, the optional canvas reference, and the
 * validated capability set. `canvasId` is `null` when the profile falls back to the form-factor
 * default canvas (design §5.3). */
export type DeviceProfileRow = {
  id: string;
  name: string;
  canvasId: string | null;
  capabilities: CapabilityFlag[];
};

/** The `DeviceProfileRow` column projection shared by every `.select()` and `.returning()` here. */
const PROFILE_COLUMNS = {
  id: deviceProfiles.id,
  name: deviceProfiles.name,
  canvasId: deviceProfiles.canvasId,
  capabilities: deviceProfiles.capabilities,
} as const;

/** Re-attach the `CapabilityFlag[]` shape the plain-jsonb `capabilities` column drops (see header). */
function toRow(row: {
  id: string;
  name: string;
  canvasId: string | null;
  capabilities: unknown;
}): DeviceProfileRow {
  return {
    id: row.id,
    name: row.name,
    canvasId: row.canvasId,
    capabilities: row.capabilities as CapabilityFlag[],
  };
}

const FOREIGN_KEY_VIOLATION = "23503";
const RESTRICT_VIOLATION = "23001";

/** The composite FKs a device (or a pending pairing code) holds on a profile, both ON DELETE RESTRICT
 * (Task 5's `devices_device_profile_fk`, and `device_pairing_codes_device_profile_fk`). A delete that
 * trips EITHER is a "still in use" conflict; matched on the constraint NAME (a `Set` membership test,
 * one branch for both) so an unrelated RESTRICT can never be mislabelled `device_profile.in_use`. */
const PROFILE_REFERENCING_CONSTRAINTS = new Set([
  "devices_device_profile_fk",
  "device_pairing_codes_device_profile_fk",
]);

/**
 * Translate the driver errors the profile write/delete paths care about into their domain codes, and
 * re-throw anything else untouched:
 *   - a `device_profiles_tenant_name_key` collision (a duplicate name per tenant, SQLSTATE 23505) →
 *     `device_profile.name_taken` — the `translateWriteError` twin from `canvas-store.ts`, matched on
 *     the CONSTRAINT NAME so the composite `device_profiles_tenant_id_key` (the FK target devices point
 *     at, a cryptographically-unreachable `defaultRandom()` clash on writes) is re-thrown untouched,
 *     with the same "no constraint name reported ⇒ translate" fallback for PGlite;
 *   - a `device_profiles_canvas_fk` violation (a `canvas_id` that is absent or belongs to another
 *     tenant, SQLSTATE 23503) → `device_profile.invalid` {reason: "bad_canvas_ref"}. Matched on the
 *     constraint name so the `tenant_id → tenants` FK (server-controlled, never client input) can
 *     never be mislabelled. The name is the only 23503 a client value can trip here;
 *   - a `devices_device_profile_fk` / `device_pairing_codes_device_profile_fk` violation (a delete of a
 *     profile a live device or pending pairing code still references, ON DELETE RESTRICT, SQLSTATE
 *     23001) → `device_profile.in_use` — a clean 409 rather than a raw 500. Matched on the constraint
 *     NAME so an unrelated RESTRICT is re-thrown untouched.
 * The 23503/23001 detection uses `@waitron/db`'s `pgErrorConstraint` (a cause-chain walk), the same
 * mechanism `@waitron/printing`'s `printers.ts` uses, not a top-level `.code` read. Exported for the
 * crafted-error unit test (`device-profile-store.test.ts`), NOT from the package barrel — the same
 * shape as `canvas-store.ts`'s `translateWriteError`.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === undefined || constraint === "device_profiles_tenant_name_key") {
      throw new AppError("device_profile.name_taken", {});
    }
  }
  if (pgErrorConstraint(err, FOREIGN_KEY_VIOLATION) === "device_profiles_canvas_fk") {
    throw new AppError("device_profile.invalid", { reason: "bad_canvas_ref" });
  }
  const restrictConstraint = pgErrorConstraint(err, RESTRICT_VIOLATION);
  if (restrictConstraint !== undefined && PROFILE_REFERENCING_CONSTRAINTS.has(restrictConstraint)) {
    throw new AppError("device_profile.in_use", {});
  }
  throw err;
}

/** All of the current tenant's device profiles, ordered by name. The tenant predicate scopes the read. */
export async function listDeviceProfiles(
  tx: Transaction,
  tenantId: string,
): Promise<DeviceProfileRow[]> {
  const rows = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .where(eq(deviceProfiles.tenantId, tenantId))
    .orderBy(asc(deviceProfiles.name));
  return rows.map(toRow);
}

/** One device profile by id, or `undefined` when the tenant has no such profile. */
export async function getDeviceProfile(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<DeviceProfileRow | undefined> {
  const [row] = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.tenantId, tenantId), eq(deviceProfiles.id, id)));
  if (row === undefined) return undefined;
  return toRow(row);
}

/** Create a device profile for the tenant, returning the stored row. Manager/admin only
 * (`till.configure`). */
export async function createDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    name: string;
    canvasId: string | null | undefined;
    capabilities: unknown;
  },
): Promise<DeviceProfileRow> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const capabilities = validateCapabilities(input.capabilities);
  try {
    const [row] = await tx
      .insert(deviceProfiles)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        canvasId: input.canvasId ?? null,
        capabilities,
      })
      .returning(PROFILE_COLUMNS);
    return toRow(row!);
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Replace a profile's name, canvas reference and capabilities in place, returning the stored row.
 * Manager/admin only (`till.configure`). An absent id (or another tenant's row, excluded by the tenant predicate) throws
 * `device_profile.not_found` — the by-id config-CRUD idiom `updateCanvas` uses, read back via
 * `.returning({ id })` so a PUT that matched zero rows is a 404, never a masked "saved" 204. A name
 * collision throws `device_profile.name_taken`, a bad canvas reference `device_profile.invalid`
 * {reason: "bad_canvas_ref"} (see `translateWriteError`).
 */
export async function updateDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    id: string;
    name: string;
    canvasId: string | null | undefined;
    capabilities: unknown;
  },
): Promise<DeviceProfileRow> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const capabilities = validateCapabilities(input.capabilities);
  let updated: DeviceProfileRow[];
  try {
    const rows = await tx
      .update(deviceProfiles)
      .set({
        name: input.name,
        canvasId: input.canvasId ?? null,
        capabilities,
        updatedAt: sql`now()`,
      })
      .where(and(eq(deviceProfiles.tenantId, input.tenantId), eq(deviceProfiles.id, input.id)))
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

/**
 * Delete a device profile. Manager/admin only (`till.configure`). An absent id (or another tenant's
 * row, excluded by the tenant predicate) throws `device_profile.not_found`, read back via `.returning({ id })` — the same
 * by-id config-CRUD idiom `deleteCanvas` uses, so a DELETE that matched zero rows is a 404 rather than
 * a silent success. A device (or a pending pairing code) still referencing the profile (Task 5's
 * composite FKs, ON DELETE RESTRICT) trips a 23001 restrict_violation, which `translateWriteError`
 * turns into `device_profile.in_use` (a clean 409) rather than letting the raw DB error propagate to a
 * 500 — the twin of `deleteCanvas`.
 */
export async function deleteDeviceProfile(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  let deleted: { id: string }[];
  try {
    deleted = await tx
      .delete(deviceProfiles)
      .where(and(eq(deviceProfiles.tenantId, input.tenantId), eq(deviceProfiles.id, input.id)))
      .returning({ id: deviceProfiles.id });
  } catch (error) {
    translateWriteError(error);
  }
  if (deleted.length === 0) {
    throw new AppError("device_profile.not_found", {});
  }
}
