import "./errors.js";
import { isUniqueViolation, canvases, uniqueViolationConstraint } from "@waitron/db";
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
 * `canvas-store.rls.test.ts` (real Postgres — RLS as the app role is a false pass on PGlite,
 * CLAUDE.md §4). Mirrors `store.ts` (till_layouts).
 *
 * The writers run, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateCanvas` — fail-closed on an invalid
 * `definition` (throws `canvas.invalid` before the write); (3) the drizzle write, whose 23505 on the
 * per-tenant name unique is translated to `canvas.name_taken` (see `asNameTaken`). `deleteCanvas`
 * authorises but has no definition to validate. Reads cast the opaque jsonb back to `CanvasDef`
 * WITHOUT re-running `validateCanvas` — the value was validated on the write that stored it and the
 * only writer is this service, the `getLayout` rationale (store.ts). The `as` cast re-attaches the
 * shape the plain-jsonb column drops (it is not `.$type<>()`-annotated, to avoid a
 * `@waitron/layouts` → `@waitron/db` circular dependency, see `packages/db/src/schema/canvases.ts`).
 */

/**
 * Translate the ONE driver error the canvas write paths care about — a
 * `canvases_tenant_name_key` collision (a duplicate name per tenant) — into the domain
 * `canvas.name_taken`, and re-throw anything else untouched. This closes the Phase-3 reviewer's
 * flagged gap: a duplicate name must return a clean 409, not the raw 23505 an unwrapped INSERT/UPDATE
 * would surface as a 500. The duplicate arrives as SQLSTATE 23505 wrapped in Drizzle's
 * `DrizzleQueryError`, so detection goes through `@waitron/db`'s `isUniqueViolation` (a cause-chain
 * walk), not a top-level `.code` read.
 *
 * It matches on the CONSTRAINT NAME, not merely on 23505: `canvases` also carries a
 * `(tenant_id, id)` unique (the composite-FK target devices point at), and any 23505 on THAT — or any
 * constraint added later — is re-thrown untouched rather than mislabelled `canvas.name_taken`. When
 * the driver reports no constraint name (PGlite omits it) it falls back to translating: the name key
 * is the only NON-composite unique these writes can trip on an author-supplied value (a
 * `(tenant_id, id)` clash is a cryptographically-unreachable `defaultRandom()` collision, and an
 * UPDATE never changes `id`). The same constraint-targeted shape as identity's `asEmailTaken`; pinned
 * by crafted-error unit tests in `canvas-store.test.ts` and end to end in `canvas-store.rls.test.ts`.
 * Exported for the unit test, NOT from the package barrel.
 */
export function asNameTaken(err: unknown): never {
  if (isUniqueViolation(err)) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === undefined || constraint === "canvases_tenant_name_key") {
      throw new AppError("canvas.name_taken", {});
    }
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
    asNameTaken(error);
  }
}

/**
 * Replace a canvas's name + definition in place. Manager/admin only (`till.configure`). An absent id
 * (or another tenant's row, RLS-hidden) throws `canvas.not_found` — the by-id config-CRUD idiom the
 * direct siblings on this same management surface use (`updateZone`/`updateTable`/`updateStatus` in
 * `apps/server/src/tables.ts`), read back via `.returning({ id })` so a PUT that matched zero rows is
 * a 404, never a masked "saved" 204 (e.g. a PUT to a canvas another session just deleted). A name
 * collision throws `canvas.name_taken` (see `asNameTaken`).
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
    asNameTaken(error);
  }
  if (updated.length === 0) {
    throw new AppError("canvas.not_found", {});
  }
}

/**
 * Delete a canvas. Manager/admin only (`till.configure`). No definition to validate. An absent id (or
 * another tenant's row, RLS-hidden) throws `canvas.not_found`, read back via `.returning({ id })` —
 * the same by-id config-CRUD idiom `deactivateZone`/`deactivateTable`/`deactivateStatus` (`tables.ts`)
 * use, so a DELETE that matched zero rows is a 404 rather than a silent success.
 */
export async function deleteCanvas(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; id: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const deleted = await tx
    .delete(canvases)
    .where(and(eq(canvases.tenantId, input.tenantId), eq(canvases.id, input.id)))
    .returning({ id: canvases.id });
  if (deleted.length === 0) {
    throw new AppError("canvas.not_found", {});
  }
}

/**
 * The tenant's first stored canvas of `formFactor`, else the built-in `DEFAULT_CANVASES[formFactor]`
 * — the "return-a-default-when-unauthored" precedent from getLayout (store.ts). The form factor is
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
