// Side-effect import: registers the `station.*`/`course.*` codes this file throws (errors.ts).
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  categories,
  fireControlMode,
  isUniqueViolation,
  kitchenCourses,
  kitchenStations,
  products,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { productWithId, type ProductScope } from "@waitron/catalogue";
import type { TillConfig } from "./till-config.js";

// Nothing here authorizes. The write verbs are called only from the kitchen routes, gated by
// `venue.configure` (`withVenueAuth` in management-api.ts), and the product editor's save, gated by
// `CATALOGUE_WRITE_PERMISSION` (catalogue-api.ts). The reads have other callers, not all gated.

export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  /** The venue's single fallback station, enforced by the partial unique `kitchen_stations_default_key`.
   *  Written only by {@link setDefaultStation} / {@link createStation}, never a plain update. */
  isDefault: boolean;
  active: boolean;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

/**
 * Assert `stationId` names a LIVE station of this venue — present, `active`, and in
 * `cfg.locationId`; otherwise `station.not_found`. The foreign keys to a station enforce existence
 * only, so this read is what rejects a retired or another venue's station.
 */
export async function requireLiveStation(
  tx: Transaction,
  cfg: TillConfig,
  stationId: string,
): Promise<void> {
  const { rows } = await tx.execute<{ active: boolean | null }>(
    sql`select (select ${kitchenStations.active} from ${kitchenStations}
      where ${kitchenStations.id} = ${stationId}
        and ${kitchenStations.locationId} = ${cfg.locationId}) as active`,
  );
  if (!rows[0]!.active) {
    throw new AppError("station.not_found", { stationId });
  }
}

/**
 * Clear the venue's current default station. A new default is always clear-then-set, because
 * `kitchen_stations_default_key` allows only one default per location.
 */
async function clearDefault(tx: Transaction, cfg: TillConfig): Promise<void> {
  await tx
    .update(kitchenStations)
    .set({ isDefault: false })
    .where(
      and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
}

/**
 * Create a kitchen station in `cfg.locationId`. A duplicate `(location, name)` is
 * `station.name_taken`. Marking it default clears any prior default first.
 */
export async function createStation(
  tx: Transaction,
  cfg: TillConfig,
  input: { name: string; displayOrder?: number; isDefault?: boolean },
): Promise<{ id: string }> {
  if (input.isDefault) {
    await clearDefault(tx, cfg);
  }
  try {
    const [row] = await tx
      .insert(kitchenStations)
      .values({
        locationId: cfg.locationId,
        name: input.name,
        displayOrder: input.displayOrder ?? 0,
        isDefault: input.isDefault ?? false,
      })
      .returning({ id: kitchenStations.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("station.name_taken", { name: input.name });
    }
    throw error;
  }
}

/** The venue's ACTIVE stations, by `display_order` then `name`. */
export async function listStations(tx: Transaction, cfg: TillConfig): Promise<Station[]> {
  return tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      displayOrder: kitchenStations.displayOrder,
      isDefault: kitchenStations.isDefault,
      active: kitchenStations.active,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
    })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.active, true)))
    .orderBy(kitchenStations.displayOrder, kitchenStations.name);
}

/**
 * Edit any subset of a station's fields — NOT `is_default`, which only {@link setDefaultStation}
 * may flip. The route validates the timing thresholds (`warm < overdue < forgotten`) before this is
 * called. An absent id throws `station.not_found`; a name collision throws `station.name_taken`.
 */
export async function updateStation(
  tx: Transaction,
  _cfg: TillConfig,
  id: string,
  patch: {
    name?: string;
    displayOrder?: number;
    active?: boolean;
    warmAfterMinutes?: number;
    overdueAfterMinutes?: number;
    forgottenAfterMinutes?: number;
  },
): Promise<void> {
  const set: {
    name?: string;
    displayOrder?: number;
    active?: boolean;
    warmAfterMinutes?: number;
    overdueAfterMinutes?: number;
    forgottenAfterMinutes?: number;
  } = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.warmAfterMinutes !== undefined) set.warmAfterMinutes = patch.warmAfterMinutes;
  if (patch.overdueAfterMinutes !== undefined) set.overdueAfterMinutes = patch.overdueAfterMinutes;
  if (patch.forgottenAfterMinutes !== undefined)
    set.forgottenAfterMinutes = patch.forgottenAfterMinutes;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(kitchenStations)
      .set(set)
      .where(eq(kitchenStations.id, id))
      .returning({ id: kitchenStations.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `name` participates in a unique an UPDATE can trip here, so it was necessarily supplied.
      throw new AppError("station.name_taken", { name: patch.name! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("station.not_found", { stationId: id });
  }
}

/** Deactivate a station — never a hard delete, since a `ticket_items.station_id` snapshot may
 *  reference it. `is_default` is left as-is; firing's fallback requires an ACTIVE default, so a
 *  venue whose only default is deactivated fails with `station.no_default` until a new one is set. */
export async function deactivateStation(
  tx: Transaction,
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(kitchenStations)
    .set({ active: false })
    .where(eq(kitchenStations.id, id))
    .returning({ id: kitchenStations.id });
  if (updated.length === 0) {
    throw new AppError("station.not_found", { stationId: id });
  }
}

/**
 * Make station `id` the venue's single default. The target must be a LIVE station of this venue,
 * checked before any write so a bad id never clears the existing default.
 */
export async function setDefaultStation(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  await requireLiveStation(tx, cfg, id);
  await clearDefault(tx, cfg);
  await tx.update(kitchenStations).set({ isDefault: true }).where(eq(kitchenStations.id, id));
}

/**
 * Set (or clear, with `null`) a category's default routing station. A non-null `stationId` must be
 * a LIVE station of this venue. An absent `categoryId` matches no row and is a no-op.
 */
export async function setCategoryStation(
  tx: Transaction,
  cfg: TillConfig,
  categoryId: string,
  stationId: string | null,
): Promise<void> {
  if (stationId !== null) {
    await requireLiveStation(tx, cfg, stationId);
  }
  await tx.update(categories).set({ stationId }).where(eq(categories.id, categoryId));
}

/**
 * Set (or clear, with `null`) a product's override routing station, which wins over its category's.
 * A non-null `stationId` must be a LIVE station of this venue. An absent `productId`, or a variant's
 * unless `scope` is `"any"`, is a no-op.
 */
export async function setProductStation(
  tx: Transaction,
  cfg: TillConfig,
  productId: string,
  stationId: string | null,
  scope: ProductScope = "top-level",
): Promise<void> {
  if (stationId !== null) {
    await requireLiveStation(tx, cfg, stationId);
  }
  await tx.update(products).set({ stationId }).where(productWithId(productId, scope));
}

/** `line` = per-line bump only; `ticket` = the station display also offers a whole-ticket bump.
 *  The per-line ticket-item state is always the source of truth. */
export type BumpMode = "line" | "ticket";

export async function setBumpMode(tx: Transaction, cfg: TillConfig, mode: BumpMode): Promise<void> {
  await tx.execute(sql`update locations set bump_mode = ${mode} where id = ${cfg.locationId}`);
}

/** Which surface shows the per-course fire action. It governs only the UI; `fireCourse` is the same
 *  whichever is chosen. The dashboard and till keep hand-written copies of this union, because the
 *  browser bundle cannot import `@waitron/db` — add a mode to each by hand. */
export type FireControl = (typeof fireControlMode.enumValues)[number];

export async function getFireControl(tx: Transaction, cfg: TillConfig): Promise<FireControl> {
  const { rows } = await tx.execute<{ fire_control: FireControl }>(
    sql`select fire_control from locations where id = ${cfg.locationId}`,
  );
  return rows[0]!.fire_control;
}

export async function setFireControl(
  tx: Transaction,
  cfg: TillConfig,
  mode: FireControl,
): Promise<void> {
  await tx.execute(sql`update locations set fire_control = ${mode} where id = ${cfg.locationId}`);
}

// ── Kitchen courses ──────────────────────────────────────────────────────────────────────────────
// Like the station verbs, minus the default: a line with no course fires earliest.

export interface Course {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * Assert `courseId` names a LIVE course of this venue — present, `active`, and in
 * `cfg.locationId`; otherwise `course.not_found`.
 */
export async function requireLiveCourse(
  tx: Transaction,
  cfg: TillConfig,
  courseId: string,
): Promise<void> {
  const { rows } = await tx.execute<{ active: boolean | null }>(
    sql`select (select ${kitchenCourses.active} from ${kitchenCourses}
      where ${kitchenCourses.id} = ${courseId}
        and ${kitchenCourses.locationId} = ${cfg.locationId}) as active`,
  );
  if (!rows[0]!.active) {
    throw new AppError("course.not_found", { courseId });
  }
}

/**
 * Assert `courseId` names a course of this venue, active or not; otherwise `course.not_found`.
 * A course deactivated while it holds items must stay fireable: its held food already carries the
 * course, so releasing it needs the course to exist, not to be offered. A NEW routing target uses
 * {@link requireLiveCourse}.
 */
export async function requireCourse(
  tx: Transaction,
  cfg: TillConfig,
  courseId: string,
): Promise<void> {
  const { rows } = await tx.execute<{ active: boolean | null }>(
    sql`select (select ${kitchenCourses.active} from ${kitchenCourses}
      where ${kitchenCourses.id} = ${courseId}
        and ${kitchenCourses.locationId} = ${cfg.locationId}) as active`,
  );
  if (rows[0]!.active === null) {
    throw new AppError("course.not_found", { courseId });
  }
}

/** Create a kitchen course in `cfg.locationId`. A duplicate `(location, name)` is `course.name_taken`. */
export async function createCourse(
  tx: Transaction,
  cfg: TillConfig,
  input: { name: string; displayOrder?: number },
): Promise<{ id: string }> {
  try {
    const [row] = await tx
      .insert(kitchenCourses)
      .values({
        locationId: cfg.locationId,
        name: input.name,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: kitchenCourses.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("course.name_taken", { name: input.name });
    }
    throw error;
  }
}

/** The venue's ACTIVE courses in firing order: lowest `display_order` first, then `name`. */
export async function listCourses(tx: Transaction, cfg: TillConfig): Promise<Course[]> {
  return tx
    .select({
      id: kitchenCourses.id,
      name: kitchenCourses.name,
      displayOrder: kitchenCourses.displayOrder,
      active: kitchenCourses.active,
    })
    .from(kitchenCourses)
    .where(and(eq(kitchenCourses.locationId, cfg.locationId), eq(kitchenCourses.active, true)))
    .orderBy(kitchenCourses.displayOrder, kitchenCourses.name);
}

/**
 * Edit any subset of a course's `name`/`displayOrder`/`active`. An absent id throws
 * `course.not_found`; a name collision throws `course.name_taken`.
 */
export async function updateCourse(
  tx: Transaction,
  _cfg: TillConfig,
  id: string,
  patch: { name?: string; displayOrder?: number; active?: boolean },
): Promise<void> {
  const set: { name?: string; displayOrder?: number; active?: boolean } = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;
  if (patch.active !== undefined) set.active = patch.active;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(kitchenCourses)
      .set(set)
      .where(eq(kitchenCourses.id, id))
      .returning({ id: kitchenCourses.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `name` participates in a unique an UPDATE can trip here, so it was necessarily supplied.
      throw new AppError("course.name_taken", { name: patch.name! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("course.not_found", { courseId: id });
  }
}

/** Deactivate a course — never a hard delete, since a `ticket_items.course_id` snapshot may
 *  reference it. */
export async function deactivateCourse(
  tx: Transaction,
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(kitchenCourses)
    .set({ active: false })
    .where(eq(kitchenCourses.id, id))
    .returning({ id: kitchenCourses.id });
  if (updated.length === 0) {
    throw new AppError("course.not_found", { courseId: id });
  }
}

/**
 * Set (or clear, with `null`) a product's default kitchen course, used when a line carries no
 * override. A non-null `courseId` must be a LIVE course of this venue. An absent `productId`, or a
 * variant's unless `scope` is `"any"`, is a no-op.
 */
export async function setProductCourse(
  tx: Transaction,
  cfg: TillConfig,
  productId: string,
  courseId: string | null,
  scope: ProductScope = "top-level",
): Promise<void> {
  if (courseId !== null) {
    await requireLiveCourse(tx, cfg, courseId);
  }
  await tx.update(products).set({ courseId }).where(productWithId(productId, scope));
}
