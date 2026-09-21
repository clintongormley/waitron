import "./errors.js";
import {
  FOREIGN_KEY_VIOLATION,
  RESTRICT_VIOLATION,
  constraintTarget,
  deviceProfiles,
  isUniqueViolation,
  refusalOn,
  sameTarget,
} from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { asc, eq, sql } from "drizzle-orm";
import type { CapabilityFlag, FormFactor } from "./canvas.js";
import { validateCapabilities, validateInactivityTimeout } from "./device-profile.js";

/**
 * The list/get/create/update/delete service over `device_profiles` (design 2026-09-05 §5.1). MANY rows,
 * keyed by `id`, with distinct names. The twin of `canvas-store.ts`, sharing its
 * shape exactly — read that file's header for the (tx, …)-is-caller-scoped convention.
 *
 * Every function takes the caller's transaction, opened with
 * `withTransaction(deps.db, …)` + `asAppUser(tx)`. Exercised in
 * `device-profile-store.pg.test.ts` (real Postgres, as a non-superuser `app_user` member — PGlite
 * holds every grant, CLAUDE.md §4).
 *
 * The writers run, in order: (1) `authorizeManager(..., "layout.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateCapabilities` — fail-closed on an
 * unknown capability flag (throws `device_profile.invalid` {reason: "bad_capabilities"} before the
 * write, since capabilities drive the /api/pay + /api/drawer firewall); (3) the drizzle write, whose
 * 23505 on the name unique becomes `device_profile.name_taken` and whose 23503 on
 * `device_profiles_canvas_fk` becomes `device_profile.invalid`
 * {reason: "bad_canvas_ref"} (see `translateWriteError`). `deleteDeviceProfile` authorises but has no
 * capabilities to validate. Reads return `capabilities` as PARSED jsonb (an array) — no `::text[]`
 * cast: it is a jsonb column, not PG `name[]` (the `name[]` cast note is in
 * `docs/developers/testing-guide.md`). The `as`
 * cast re-attaches the `CapabilityFlag[]` shape the plain-jsonb column drops (it carries no
 * `@waitron/layouts` type, to avoid a `@waitron/layouts` → `@waitron/db` circular dependency, see
 * `packages/db/src/schema/device-profiles.ts`).
 */

/** The shape every read and write returns: identity, name, the optional canvas reference, and the
 * validated capability set. `canvasId` is `null` when the profile falls back to the form-factor
 * default canvas (design §5.3). */
export type DeviceProfileRow = {
  id: string;
  name: string;
  formFactor: FormFactor;
  canvasId: string | null;
  capabilities: CapabilityFlag[];
  /** The auto-logout idle timeout in seconds; `null` = never (always `null` for a `kds` profile). */
  inactivityTimeoutSeconds: number | null;
};

/** The `DeviceProfileRow` column projection shared by every `.select()` and `.returning()` here. */
const PROFILE_COLUMNS = {
  id: deviceProfiles.id,
  name: deviceProfiles.name,
  formFactor: deviceProfiles.formFactor,
  canvasId: deviceProfiles.canvasId,
  capabilities: deviceProfiles.capabilities,
  inactivityTimeoutSeconds: deviceProfiles.inactivityTimeoutSeconds,
} as const;

/** Re-attach the `CapabilityFlag[]` shape the plain-jsonb `capabilities` column drops (see header). */
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

/** `device_profiles_tenant_name_key`: UNIQUE (name) on device_profiles,
 * migration `0033` line 230, in `packages/db/drizzle/`. */
const PROFILE_NAME: ConstraintTarget = { table: "device_profiles", columns: ["name"] };

/** What a `canvas_id` naming no canvas reports — the referencing column of
 * `device_profiles_canvas_fk`, migration `0034` line 36, in `packages/db/drizzle/`. It is the
 * only foreign key a client value can trip on these writes. */
const PROFILE_CANVAS_REF: ConstraintTarget = {
  table: "device_profiles",
  columns: ["canvas_id"],
};

/** What a delete refused by `devices_device_profile_fk` reports — devices.device_profile_id →
 * device_profiles.id ON DELETE RESTRICT, migration `0034` line 32, in `packages/db/drizzle/`;
 * driven in `device-profile-store.pg.test.ts`. The referencing/referenced split is
 * `constraintTarget`'s (`packages/db/src/constraint-target.ts`).
 * It does NOT single out that foreign key, where the constraint name it replaced did: every ON
 * DELETE RESTRICT key out of `devices` references its parent's `id` — `devices_till_fk` and
 * `devices_receipt_printer_fk` (same migration, lines 25 and 29) and the declared `location_id` one
 * as well — so a refused till, printer or location delete reports this identical pair. Measured
 * 2026-09-21 on a PGlite reproduction of those four keys: each delete answers `23001`,
 * `table: devices`, `Key (id)=(…)`, and only `constraint` differs. CALL SCOPE is what keeps this
 * branch right: nothing outside this file calls `translateWriteError`, so the only
 * restrict_violation reaching it is a profile delete's — and `devices` is still the only table that
 * references a profile. */
const PROFILE_REFERENCED_BY_DEVICE: ConstraintTarget = { table: "devices", columns: ["id"] };

/**
 * Translate the driver refusals the profile write/delete paths care about into their domain codes,
 * and re-throw anything else untouched:
 *   - a duplicate profile name (SQLSTATE 23505 on {@link PROFILE_NAME}) → `device_profile.name_taken`
 *     — the `translateWriteError` twin from `canvas-store.ts`, with the same two edges: a 23505 on
 *     any other key of `device_profiles` is re-thrown untouched, and a 23505 that named no key at
 *     all is translated anyway (the name key is the only unique these writes can trip on an
 *     author-supplied value);
 *   - a `canvas_id` that names no canvas (SQLSTATE 23503 on {@link PROFILE_CANVAS_REF}) →
 *     `device_profile.invalid` {reason: "bad_canvas_ref"};
 *   - a delete refused because a live device still references the profile (SQLSTATE 23001 on
 *     {@link PROFILE_REFERENCED_BY_DEVICE}) → `device_profile.in_use`, a clean 409 rather than a raw
 *     500. A restrict_violation from any other foreign key is re-thrown untouched.
 * The 23505 branch stays on `constraintTarget`/`sameTarget` because it also translates a refusal
 * whose key could not be identified, which `refusalOn` cannot express. The two 23503/23001 targets of
 * `device_profiles_canvas_fk` differ — a bad reference names `canvas_id`, a refused canvas delete
 * names `id` — so only the profile's own refusal reaches the `bad_canvas_ref` branch.
 * Exported for the crafted-error unit test (`device-profile-store.test.ts`), NOT from the package
 * barrel — the same shape as `canvas-store.ts`'s `translateWriteError`.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const target = constraintTarget(err);
    if (target === undefined || sameTarget(target, PROFILE_NAME)) {
      throw new AppError("device_profile.name_taken", {});
    }
  }
  if (refusalOn(err, FOREIGN_KEY_VIOLATION, PROFILE_CANVAS_REF)) {
    throw new AppError("device_profile.invalid", { reason: "bad_canvas_ref" });
  }
  if (refusalOn(err, RESTRICT_VIOLATION, PROFILE_REFERENCED_BY_DEVICE)) {
    throw new AppError("device_profile.in_use", {});
  }
  throw err;
}

/** All device profiles, ordered by name. */
export async function listDeviceProfiles(tx: Transaction): Promise<DeviceProfileRow[]> {
  const rows = await tx
    .select(PROFILE_COLUMNS)
    .from(deviceProfiles)
    .orderBy(asc(deviceProfiles.name));
  return rows.map(toRow);
}

/** One device profile by id, or `undefined` when no profile carries that id. */
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

/** Create a device profile, returning the stored row. Manager/admin only
 * (`layout.configure`). */
export async function createDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    /** Inert: nothing here reads it. apps/server and provisioning still supply it; the field goes
     * when those callers do. */
    name: string;
    formFactor: FormFactor;
    canvasId: string | null | undefined;
    capabilities: unknown;
    // Optional so a caller that has not adopted the field yet (the management routes, wired in a later
    // task) keeps compiling; an omitted value stores NULL (never). `kds` is forced NULL regardless.
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

/**
 * Replace a profile's name, canvas reference and capabilities in place, returning the stored row.
 * Manager/admin only (`layout.configure`). An absent id throws
 * `device_profile.not_found` — the by-id config-CRUD idiom `updateCanvas` uses, read back via
 * `.returning({ id })` so a PUT that matched zero rows is a 404, never a masked "saved" 204. A name
 * collision throws `device_profile.name_taken`, a bad canvas reference `device_profile.invalid`
 * {reason: "bad_canvas_ref"} (see `translateWriteError`).
 */
export async function updateDeviceProfile(
  tx: Transaction,
  input: {
    managementSessionId: string;
    /** Inert: nothing here reads it. apps/server and provisioning still supply it; the field goes
     * when those callers do. */
    id: string;
    name: string;
    formFactor: FormFactor;
    canvasId: string | null | undefined;
    capabilities: unknown;
    // Optional so the not-yet-updated management routes keep compiling (later task); an omitted value
    // stores NULL. `kds` is forced NULL regardless.
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
        updatedAt: sql`now()`,
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

/**
 * Delete a device profile. Manager/admin only (`layout.configure`). An absent id throws
 * `device_profile.not_found`, read back via `.returning({ id })` — the same
 * by-id config-CRUD idiom `deleteCanvas` uses, so a DELETE that matched zero rows is a 404 rather than
 * a silent success. A device still referencing the profile (the FK, ON DELETE RESTRICT)
 * trips a 23001 restrict_violation, which `translateWriteError`
 * turns into `device_profile.in_use` (a clean 409) rather than letting the raw DB error propagate to a
 * 500 — the twin of `deleteCanvas`.
 */
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
