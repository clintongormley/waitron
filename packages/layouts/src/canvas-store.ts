import "./errors.js";
import {
  isUniqueViolation,
  canvases,
  pgErrorConstraint,
  uniqueViolationConstraint,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { DEFAULT_CANVASES } from "./default-canvases.js";
import type { FormFactor, CanvasDef } from "./canvas.js";
import { validateCanvas } from "./validate-canvas.js";

/**
 * The list/get/create/update/delete service over `canvases` (design §4, SP-A.2 §16.3). MANY
 * rows per tenant, keyed by `id`, names unique per tenant.
 *
 * Every function takes a `(tx, …)` the CALLER has already scoped — the management routes open it with
 * `withTenant(deps.db, tenantId, …)` + `asAppUser(tx)`, so the app role's tenant-isolation policy
 * supplies `current_tenant_id()` and no function here sets a GUC. Proven under that exact shape in
 * `canvas-store.pg.test.ts` (real Postgres, as a non-superuser `app_user` member — PGlite holds
 * every grant, CLAUDE.md §4). Mirrors the other stores in this package (`theme-store.ts`, `receipt-store.ts`).
 *
 * The writers run, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateCanvas` — fail-closed on an invalid
 * `definition` (throws `canvas.invalid` before the write); (3) the drizzle write, whose 23505 on the
 * per-tenant name unique is translated to `canvas.name_taken` (see `translateWriteError`). `deleteCanvas`
 * authorises but has no definition to validate. Reads cast the opaque jsonb back to `CanvasDef`
 * WITHOUT re-running `validateCanvas` — the value was validated on the write that stored it and the
 * only writer is this service (the return-a-typed-shape-without-re-validating rationale). The `as` cast re-attaches the
 * shape the plain-jsonb column drops (it is not `.$type<>()`-annotated, to avoid a
 * `@waitron/layouts` → `@waitron/db` circular dependency, see `packages/db/src/schema/canvases.ts`).
 */

/**
 * Translate the two driver errors the canvas write/delete paths care about into their domain codes,
 * and re-throw anything else untouched — the twin of `device-profile-store.ts`'s `translateWriteError`:
 *   - a `canvases_tenant_name_key` collision (a duplicate name per tenant, SQLSTATE 23505) →
 *     `canvas.name_taken`. This closes the Phase-3 reviewer's flagged gap: a duplicate name must
 *     return a clean 409, not the raw 23505 an unwrapped INSERT/UPDATE would surface as a 500. It
 *     matches on the CONSTRAINT NAME, not merely on 23505: `canvases` also carries a `(tenant_id, id)`
 *     unique (the composite-FK target devices point at), and any 23505 on THAT — or any constraint
 *     added later — is re-thrown untouched rather than mislabelled `canvas.name_taken`. When the
 *     driver reports no constraint name (PGlite omits it) it falls back to translating: the name key is
 *     the only NON-composite unique these writes can trip on an author-supplied value (a
 *     `(tenant_id, id)` clash is a cryptographically-unreachable `defaultRandom()` collision, and an
 *     UPDATE never changes `id`). The same constraint-targeted shape as identity's `asEmailTaken`;
 *   - a `device_profiles_canvas_fk` violation (a delete of a canvas a device profile still references,
 *     ON DELETE RESTRICT, SQLSTATE 23001) → `canvas.in_use` — a clean 409 rather than a raw 500.
 *     Matched on the constraint NAME so an unrelated RESTRICT is re-thrown untouched.
 * Detection goes through `@waitron/db`'s `isUniqueViolation` / `pgErrorConstraint` (cause-chain walks),
 * not a top-level `.code` read, because the driver wraps every failure in Drizzle's `DrizzleQueryError`.
 * Pinned by crafted-error unit tests in `canvas-store.test.ts` and end to end in
 * `canvas-store.pg.test.ts`. Exported for the unit test, NOT from the package barrel.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === undefined || constraint === "canvases_tenant_name_key") {
      throw new AppError("canvas.name_taken", {});
    }
  }
  if (pgErrorConstraint(err, "23001") === "device_profiles_canvas_fk") {
    throw new AppError("canvas.in_use", {});
  }
  throw err;
}

/** All of the current tenant's canvases. RLS scopes the read to the caller's tenant. */
export async function listCanvases(
  tx: Transaction,
  tenantId: string,
): Promise<{ id: string; name: string; definition: CanvasDef }[]> {
  const rows = await tx
    .select({
      id: canvases.id,
      name: canvases.name,
      definition: canvases.definition,
    })
    .from(canvases)
    .where(eq(canvases.tenantId, tenantId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    definition: row.definition as CanvasDef,
  }));
}

/** One canvas by id, or `undefined` when the tenant has no such canvas. */
export async function getCanvas(
  tx: Transaction,
  tenantId: string,
  id: string,
): Promise<{ id: string; name: string; definition: CanvasDef } | undefined> {
  const [row] = await tx
    .select({
      id: canvases.id,
      name: canvases.name,
      definition: canvases.definition,
    })
    .from(canvases)
    .where(and(eq(canvases.tenantId, tenantId), eq(canvases.id, id)));
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, definition: row.definition as CanvasDef };
}

/** Create a canvas for the tenant, returning its generated id. Manager/admin only (`till.configure`). */
export async function createCanvas(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; name: string; definition: unknown },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const definition = validateCanvas(input.definition);
  try {
    const [row] = await tx
      .insert(canvases)
      .values({ tenantId: input.tenantId, name: input.name, definition })
      .returning({ id: canvases.id });
    return { id: row!.id };
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Replace a canvas's name + definition in place. Manager/admin only (`till.configure`). An absent id
 * (or another tenant's row, RLS-hidden) throws `canvas.not_found` — the by-id config-CRUD idiom the
 * direct siblings on this same management surface use (`updateZone`/`updateTable`/`updateStatus` in
 * `apps/server/src/tables.ts`), read back via `.returning({ id })` so a PUT that matched zero rows is
 * a 404, never a masked "saved" 204 (e.g. a PUT to a canvas another session just deleted). A name
 * collision throws `canvas.name_taken` (see `translateWriteError`).
 */
export async function updateCanvas(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    id: string;
    name: string;
    definition: unknown;
  },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const definition = validateCanvas(input.definition);
  let updated: { id: string }[];
  try {
    updated = await tx
      .update(canvases)
      .set({ name: input.name, definition, updatedAt: sql`now()` })
      .where(and(eq(canvases.tenantId, input.tenantId), eq(canvases.id, input.id)))
      .returning({ id: canvases.id });
  } catch (error) {
    translateWriteError(error);
  }
  if (updated.length === 0) {
    throw new AppError("canvas.not_found", {});
  }
}

/**
 * Delete a canvas. Manager/admin only (`till.configure`). No definition to validate. An absent id (or
 * another tenant's row, RLS-hidden) throws `canvas.not_found`, read back via `.returning({ id })` —
 * the same by-id config-CRUD idiom `deactivateZone`/`deactivateTable`/`deactivateStatus` (`tables.ts`)
 * use, so a DELETE that matched zero rows is a 404 rather than a silent success. A device profile still
 * referencing the canvas (the composite FK `device_profiles_canvas_fk`, ON DELETE RESTRICT) trips a
 * 23001 restrict_violation, which `translateWriteError` turns into `canvas.in_use` (a clean 409) rather
 * than letting the raw DB error propagate to a 500.
 */
export async function deleteCanvas(
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
      .delete(canvases)
      .where(and(eq(canvases.tenantId, input.tenantId), eq(canvases.id, input.id)))
      .returning({ id: canvases.id });
  } catch (error) {
    translateWriteError(error);
  }
  if (deleted.length === 0) {
    throw new AppError("canvas.not_found", {});
  }
}

/**
 * The tenant's first stored canvas of `formFactor`, else the built-in `DEFAULT_CANVASES[formFactor]`
 * — the "return-a-default-when-unauthored" precedent shared with `getReceipt` (receipt-store.ts). The form factor is
 * carried inside the opaque `definition` jsonb (`->> 'formFactor'`), not a column; "first" is by
 * `created_at` for a stable pick when a tenant has several of one form factor.
 */
export async function getCanvasForFormFactor(
  tx: Transaction,
  tenantId: string,
  formFactor: FormFactor,
): Promise<CanvasDef> {
  const [row] = await tx
    .select({ definition: canvases.definition })
    .from(canvases)
    .where(
      and(
        eq(canvases.tenantId, tenantId),
        eq(sql`${canvases.definition} ->> 'formFactor'`, formFactor),
      ),
    )
    .orderBy(asc(canvases.createdAt))
    .limit(1);
  if (row === undefined) return DEFAULT_CANVASES[formFactor];
  return row.definition as CanvasDef;
}
