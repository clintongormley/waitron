import "./errors.js";
import {
  RESTRICT_VIOLATION,
  canvases,
  constraintTarget,
  isRefusal,
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
 * Reads return the stored definition without re-running `validateCanvas`: `createCanvas` and
 * `updateCanvas` validate before they write. The `as` casts restore a type the JSON column does
 * not carry: this package depends on `@waitron/db`, so the column cannot name one of its types
 * without a dependency cycle.
 */

const CANVAS_NAME: ConstraintTarget = { table: "canvases", columns: ["name"] };

/**
 * Translates the refusals these writes can raise into domain codes and re-throws anything else.
 *
 * A unique violation that names no key (what an index over an expression reports) is still
 * `canvas.name_taken`: the name key is the only unique these writes can trip on an author-supplied
 * value. That fallback is why this branch uses `constraintTarget`/`sameTarget`, not `refusalOn`.
 *
 * SQLite names no key in a foreign-key refusal, so the restrict branch asks only the class. That is
 * sound only while each writer's `try` wraps ONE statement on `canvases` and
 * `device_profiles.canvas_id` is the only key into `canvases` — the second half is pinned by
 * `has device_profiles.canvas_id as the ONLY key into canvases, and no key out of it`
 * (canvas-store.db.test.ts). Widen a `try` to a second statement and its refusals would be reported
 * as `canvas.in_use`, with nothing to catch it.
 *
 * Exported for canvas-store.test.ts, not from the package barrel.
 */
export function translateWriteError(err: unknown): never {
  if (isUniqueViolation(err)) {
    const target = constraintTarget(err);
    if (target === undefined || sameTarget(target, CANVAS_NAME)) {
      throw new AppError("canvas.name_taken", {});
    }
  }
  if (isRefusal(err, RESTRICT_VIOLATION)) {
    throw new AppError("canvas.in_use", {});
  }
  throw err;
}

/** In no defined order. */
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

export async function updateCanvas(
  tx: Transaction,
  input: {
    managementSessionId: string;
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
