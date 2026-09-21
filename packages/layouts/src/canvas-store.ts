import "./errors.js";
import {
  RESTRICT_VIOLATION,
  canvases,
  constraintTarget,
  isUniqueViolation,
  refusalOn,
  sameTarget,
} from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { asc, eq, sql } from "drizzle-orm";
import { DEFAULT_CANVASES } from "./default-canvases.js";
import type { FormFactor, CanvasDef } from "./canvas.js";
import { validateCanvas } from "./validate-canvas.js";

/**
 * The list/get/create/update/delete service over `canvases` (design §4, SP-A.2 §16.3). MANY
 * rows, keyed by `id`, with distinct names.
 *
 * Every function takes the caller's transaction, opened with
 * `withTransaction(deps.db, …)` + `asAppUser(tx)`. Exercised in
 * `canvas-store.pg.test.ts` (real Postgres, as a non-superuser `app_user` member — PGlite holds
 * every grant, CLAUDE.md §4). Mirrors the other stores in this package (`theme-store.ts`, `receipt-store.ts`).
 *
 * The writers run, in order: (1) `authorizeManager(..., "layout.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateCanvas` — fail-closed on an invalid
 * `definition` (throws `canvas.invalid` before the write); (3) the drizzle write, whose 23505 on the
 * name unique is translated to `canvas.name_taken` (see `translateWriteError`). `deleteCanvas`
 * authorises but has no definition to validate. Reads cast the opaque jsonb back to `CanvasDef`
 * WITHOUT re-running `validateCanvas` — the value was validated on the write that stored it and the
 * only writer is this service (the return-a-typed-shape-without-re-validating rationale). The `as`
 * cast re-attaches the shape the plain-jsonb column drops (it carries no `@waitron/layouts` type,
 * to avoid a `@waitron/layouts` → `@waitron/db` circular dependency, see
 * `packages/db/src/schema/canvases.ts`).
 */

/** `canvases_tenant_name_key`: UNIQUE (name) on canvases,
 * migration `0033` line 229, in `packages/db/drizzle/`. */
const CANVAS_NAME: ConstraintTarget = { table: "canvases", columns: ["name"] };

/** What a delete refused by `device_profiles_canvas_fk` reports — device_profiles.canvas_id →
 * canvases.id ON DELETE RESTRICT, migration `0034` line 36, in `packages/db/drizzle/`; driven in
 * `canvas-store.pg.test.ts`. Not the same target as that FK's 23503, which names `canvas_id`.
 * A target names no constraint, so it tells this key apart from a sibling only while there is none:
 * that migration leaves it the only foreign key out of `device_profiles`, and a second RESTRICT key
 * out of that table to a parent keyed on `id` would report exactly this pair. Call scope is what
 * keeps the match right meanwhile — see `translateWriteError`. */
const CANVAS_REFERENCED_BY_PROFILE: ConstraintTarget = {
  table: "device_profiles",
  columns: ["id"],
};

/**
 * Translate the two driver refusals the canvas write/delete paths care about into their domain
 * codes, and re-throw anything else untouched — the twin of `device-profile-store.ts`'s
 * `translateWriteError`:
 *   - a duplicate canvas name (SQLSTATE 23505 on {@link CANVAS_NAME}) → `canvas.name_taken`, so a
 *     duplicate returns a clean 409 rather than the raw 23505 an unwrapped INSERT/UPDATE would
 *     surface as a 500. A 23505 on any OTHER key of `canvases` is re-thrown untouched rather than
 *     mislabelled. A 23505 that named no key at all — {@link constraintTarget} returns `undefined` —
 *     is translated anyway: the name key is the only unique these writes can trip on an
 *     author-supplied value (the primary key is a cryptographically-unreachable `defaultRandom()`
 *     collision, and an UPDATE never changes `id`);
 *   - a delete refused because a device profile still references the canvas (SQLSTATE 23001 on
 *     {@link CANVAS_REFERENCED_BY_PROFILE}) → `canvas.in_use`, a clean 409 rather than a raw 500. A
 *     restrict_violation from any other foreign key is re-thrown untouched.
 * The 23505 branch stays on `constraintTarget`/`sameTarget` because it also translates a refusal
 * whose key could not be identified, which `refusalOn` cannot express.
 * Nothing outside this file calls it — exported for the unit test, NOT from the package barrel — so
 * the only refusals it ever sees are the ones this store's own statements raise.
 * Pinned by crafted-error unit tests in `canvas-store.test.ts` and end to end in
 * `canvas-store.pg.test.ts`.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const target = constraintTarget(err);
    if (target === undefined || sameTarget(target, CANVAS_NAME)) {
      throw new AppError("canvas.name_taken", {});
    }
  }
  if (refusalOn(err, RESTRICT_VIOLATION, CANVAS_REFERENCED_BY_PROFILE)) {
    throw new AppError("canvas.in_use", {});
  }
  throw err;
}

/** All canvases, in no defined order (the query has no ORDER BY). */
export async function listCanvases(
  tx: Transaction,
): Promise<{ id: string; name: string; definition: CanvasDef }[]> {
  const rows = await tx
    .select({
      id: canvases.id,
      name: canvases.name,
      definition: canvases.definition,
    })
    .from(canvases);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    definition: row.definition as CanvasDef,
  }));
}

/** One canvas by id, or `undefined` when no canvas carries that id. */
export async function getCanvas(
  tx: Transaction,
  id: string,
): Promise<{ id: string; name: string; definition: CanvasDef } | undefined> {
  const [row] = await tx
    .select({
      id: canvases.id,
      name: canvases.name,
      definition: canvases.definition,
    })
    .from(canvases)
    .where(eq(canvases.id, id));
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, definition: row.definition as CanvasDef };
}

/** Create a canvas, returning its generated id. Manager/admin only (`layout.configure`). */
export async function createCanvas(
  tx: Transaction,
  input: { managementSessionId: string; name: string; definition: unknown },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const definition = validateCanvas(input.definition);
  try {
    const [row] = await tx
      .insert(canvases)
      .values({ name: input.name, definition })
      .returning({ id: canvases.id });
    return { id: row!.id };
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Replace a canvas's name + definition in place. Manager/admin only (`layout.configure`). An absent id
 * throws `canvas.not_found` — the by-id config-CRUD idiom the
 * direct siblings on this same management surface use (`updateZone`/`updateTable`/`updateStatus` in
 * `apps/server/src/tables.ts`), read back via `.returning({ id })` so a PUT that matched zero rows is
 * a 404, never a masked "saved" 204 (e.g. a PUT to a canvas another session just deleted). A name
 * collision throws `canvas.name_taken` (see `translateWriteError`).
 */
export async function updateCanvas(
  tx: Transaction,
  input: {
    managementSessionId: string;
    /** Inert: nothing here reads it. apps/server and provisioning still supply it; the field goes
     * when those callers do. */
    id: string;
    name: string;
    definition: unknown;
  },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const definition = validateCanvas(input.definition);
  let updated: { id: string }[];
  try {
    updated = await tx
      .update(canvases)
      .set({ name: input.name, definition, updatedAt: sql`now()` })
      .where(eq(canvases.id, input.id))
      .returning({ id: canvases.id });
  } catch (error) {
    translateWriteError(error);
  }
  if (updated.length === 0) {
    throw new AppError("canvas.not_found", {});
  }
}

/**
 * Delete a canvas. Manager/admin only (`layout.configure`). No definition to validate. An absent id
 * throws `canvas.not_found`, read back via `.returning({ id })` —
 * the same by-id config-CRUD idiom `deactivateZone`/`deactivateTable`/`deactivateStatus` (`tables.ts`)
 * use, so a DELETE that matched zero rows is a 404 rather than a silent success. A device profile still
 * referencing the canvas (`device_profiles_canvas_fk`, ON DELETE RESTRICT) trips a
 * 23001 restrict_violation, which `translateWriteError` turns into `canvas.in_use` (a clean 409) rather
 * than letting the raw DB error propagate to a 500.
 */
export async function deleteCanvas(
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
      .delete(canvases)
      .where(eq(canvases.id, input.id))
      .returning({ id: canvases.id });
  } catch (error) {
    translateWriteError(error);
  }
  if (deleted.length === 0) {
    throw new AppError("canvas.not_found", {});
  }
}

/**
 * The first stored canvas of `formFactor`, else the built-in `DEFAULT_CANVASES[formFactor]`
 * — the "return-a-default-when-unauthored" precedent shared with `getReceipt` (receipt-store.ts). The form factor is
 * carried inside the opaque `definition` jsonb (`->> 'formFactor'`), not a column; "first" is by
 * `created_at` for a stable pick when several canvases share one form factor.
 */
export async function getCanvasForFormFactor(
  tx: Transaction,
  formFactor: FormFactor,
): Promise<CanvasDef> {
  const [row] = await tx
    .select({ definition: canvases.definition })
    .from(canvases)
    .where(eq(sql`${canvases.definition} ->> 'formFactor'`, formFactor))
    .orderBy(asc(canvases.createdAt))
    .limit(1);
  if (row === undefined) return DEFAULT_CANVASES[formFactor];
  return row.definition as CanvasDef;
}
