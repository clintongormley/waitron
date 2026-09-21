import "./errors.js";
import {
  RESTRICT_VIOLATION,
  canvases,
  constraintTarget,
  isPgError,
  isUniqueViolation,
  nowIso,
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
 * Every function takes the caller's transaction, opened with `withTransaction(deps.db, …)`.
 * Exercised against a real migrated database in `canvas-store.db.test.ts`. Mirrors the other
 * stores in this package (`theme-store.ts`, `receipt-store.ts`).
 *
 * The writers run, in order: (1) `authorizeManager(..., "layout.configure")` — the write gate, before
 * any DB write, proven by-deletion in the suite; (2) `validateCanvas` — fail-closed on an invalid
 * `definition` (throws `canvas.invalid` before the write); (3) the drizzle write, whose unique
 * violation on the name key is translated to `canvas.name_taken` (see `translateWriteError`). `deleteCanvas`
 * authorises but has no definition to validate. Reads cast the opaque JSON document back to `CanvasDef`
 * WITHOUT re-running `validateCanvas` — the value was validated on the write that stored it and the
 * only writer is this service (the return-a-typed-shape-without-re-validating rationale). The `as`
 * cast re-attaches the shape the plain-JSON column drops (it carries no `@waitron/layouts` type,
 * to avoid a `@waitron/layouts` → `@waitron/db` circular dependency, see
 * `packages/db/src/schema/canvases.ts`).
 */

/** The unique index `canvases_tenant_name_key` over (name), declared in
 * `packages/db/drizzle/0000_baseline.sql`. A unique violation is one of the few classes SQLite
 * reports a table and columns for, so this is the key a duplicate name names. */
const CANVAS_NAME: ConstraintTarget = { table: "canvases", columns: ["name"] };

/**
 * Translate the two driver refusals the canvas write/delete paths care about into their domain
 * codes, and re-throw anything else untouched — the twin of `device-profile-store.ts`'s
 * `translateWriteError`:
 *   - a duplicate canvas name (a unique violation on {@link CANVAS_NAME}) → `canvas.name_taken`, so
 *     a duplicate returns a clean 409 rather than the raw refusal an unwrapped INSERT/UPDATE would
 *     surface as a 500. A unique violation on any OTHER key of `canvases` is re-thrown untouched
 *     rather than mislabelled. One that named no key at all — {@link constraintTarget} returns
 *     `undefined`, which is what a unique index over an EXPRESSION reports — is translated anyway:
 *     the name key is the only unique these writes can trip on an author-supplied value (the
 *     primary key is a cryptographically-unreachable `newId()` collision, and an UPDATE never
 *     changes `id`);
 *   - a delete refused because a device profile still references the canvas → `canvas.in_use`, a
 *     clean 409 rather than a raw 500.
 *
 * The unique branch stays on `constraintTarget`/`sameTarget` because it also translates a refusal
 * whose key could not be identified, which `refusalOn` cannot express.
 *
 * **Why the restrict branch asks only the CLASS.** SQLite reports a foreign-key refusal as
 * `FOREIGN KEY constraint failed` and nothing else — no table, no column, no constraint name — in
 * both directions (measured on node:sqlite, Node v26.7.0; the codes are driven in
 * `packages/db/src/constraint-target.sqlite.test.ts`). What it does separate is the direction: 1811
 * for a delete refused by an `ON DELETE RESTRICT` key, 787 for a written value naming no parent. So
 * the target this branch used to match on is unavailable, and CALL SCOPE stands in its place:
 * nothing outside this file calls `translateWriteError`, `canvases` declares no foreign key of its
 * own to trip, and `device_profiles.canvas_id` is the only key referencing it
 * (`packages/db/drizzle/0000_baseline.sql`) — so a restrict refusal reaching here can only be a
 * canvas a profile still binds. What that costs, stated because a reader would otherwise assume
 * the old guarantee: a restrict refusal raised inside these four functions by some unrelated key
 * would now be labelled `canvas.in_use` rather than re-thrown.
 *
 * No other PRODUCTION file calls it — exported for the unit test, NOT from the package barrel — so
 * the only refusals it ever sees are the ones this store's own statements raise.
 * Pinned by crafted-error unit tests in `canvas-store.test.ts` and end to end in
 * `canvas-store.db.test.ts`.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const target = constraintTarget(err);
    if (target === undefined || sameTarget(target, CANVAS_NAME)) {
      throw new AppError("canvas.name_taken", {});
    }
  }
  if (isPgError(err, RESTRICT_VIOLATION)) {
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
      .set({ name: input.name, definition, updatedAt: nowIso() })
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
 * referencing the canvas (`device_profiles_canvas_fk`, ON DELETE RESTRICT) trips a restrict
 * refusal, which `translateWriteError` turns into `canvas.in_use` (a clean 409) rather
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
 * carried inside the opaque `definition` JSON document (`->> 'formFactor'`), not a column; "first"
 * is by `created_at` for a stable pick when several canvases share one form factor. SQLite reads
 * `->>` with a text label on the right the same way PostgreSQL did — measured on node:sqlite, Node
 * v26.7.0, against a document stored through this package's own column type.
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
