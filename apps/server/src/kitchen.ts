// Side-effect import: registers the `station.*`/`course.*` codes this file throws (errors.ts).
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  fireControlMode,
  isUniqueViolation,
  kitchenCourses,
  products,
  kitchenStations,
  kitchenStationTiming,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { productWithId, type ProductScope } from "@waitron/catalogue";
import type { TillConfig } from "./till-config.js";
import { assertStationTiming, getKitchenTimingDefaults } from "./kitchen-timing.js";
import type { StationTimingPatch } from "./kitchen-timing.js";

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
  showsRestOfOrder: boolean;
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
  input: {
    name: string;
    displayOrder?: number;
    isDefault?: boolean;
    thresholds?: StationTimingPatch;
  },
): Promise<{ id: string }> {
  if (input.thresholds !== undefined) {
    assertStationTiming(input.thresholds, await getKitchenTimingDefaults(tx, cfg), {
      name: input.name,
    });
  }
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
    if (input.thresholds !== undefined && Object.keys(input.thresholds).length > 0) {
      await tx.insert(kitchenStationTiming).values({ stationId: row!.id, ...input.thresholds });
    }
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
  const defaults = await getKitchenTimingDefaults(tx, cfg);
  const stations = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      displayOrder: kitchenStations.displayOrder,
      isDefault: kitchenStations.isDefault,
      active: kitchenStations.active,
      showsRestOfOrder: kitchenStations.showsRestOfOrder,
      warmAfterMinutes: kitchenStationTiming.warmAfterMinutes,
      overdueAfterMinutes: kitchenStationTiming.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStationTiming.forgottenAfterMinutes,
    })
    .from(kitchenStations)
    .leftJoin(kitchenStationTiming, eq(kitchenStationTiming.stationId, kitchenStations.id))
    .where(and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.active, true)))
    .orderBy(kitchenStations.displayOrder, kitchenStations.name);
  return stations.map((station) => ({
    ...station,
    warmAfterMinutes: station.warmAfterMinutes ?? defaults.warmAfterMinutes,
    overdueAfterMinutes: station.overdueAfterMinutes ?? defaults.overdueAfterMinutes,
    forgottenAfterMinutes: station.forgottenAfterMinutes ?? defaults.forgottenAfterMinutes,
  }));
}

export async function updateStation(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  patch: {
    name?: string;
    displayOrder?: number;
    active?: boolean;
    showsRestOfOrder?: boolean;
  } & StationTimingPatch,
): Promise<void> {
  const { warmAfterMinutes, overdueAfterMinutes, forgottenAfterMinutes, ...set } = patch;
  const timingPatch: StationTimingPatch = {};
  if (warmAfterMinutes !== undefined) timingPatch.warmAfterMinutes = warmAfterMinutes;
  if (overdueAfterMinutes !== undefined) timingPatch.overdueAfterMinutes = overdueAfterMinutes;
  if (forgottenAfterMinutes !== undefined)
    timingPatch.forgottenAfterMinutes = forgottenAfterMinutes;
  const [station] = await tx
    .select({ name: kitchenStations.name, timing: kitchenStationTiming })
    .from(kitchenStations)
    .leftJoin(kitchenStationTiming, eq(kitchenStationTiming.stationId, kitchenStations.id))
    .where(and(eq(kitchenStations.id, id), eq(kitchenStations.locationId, cfg.locationId)));
  if (station === undefined) throw new AppError("station.not_found", { stationId: id });
  const hasTiming = Object.keys(timingPatch).length > 0;
  if (hasTiming) {
    assertStationTiming(
      { ...station.timing, ...timingPatch },
      await getKitchenTimingDefaults(tx, cfg),
      { id, name: station.name },
    );
  }
  try {
    if (Object.keys(set).length > 0) {
      await tx.update(kitchenStations).set(set).where(eq(kitchenStations.id, id));
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("station.name_taken", { name: patch.name! });
    }
    throw error;
  }
  if (hasTiming) {
    await tx
      .insert(kitchenStationTiming)
      .values({ stationId: id, ...timingPatch })
      .onConflictDoUpdate({ target: kitchenStationTiming.stationId, set: timingPatch });
  }
}

/** Deactivate a station — never a hard delete, since a `ticket_items.station_id` snapshot may
 *  reference it. */
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

/** `line` = per-line bump only; `ticket` = the station display also offers a whole-ticket bump.
 *  The per-line ticket-item state is always the source of truth. */
export type BumpMode = "line" | "ticket";

export async function setBumpMode(tx: Transaction, cfg: TillConfig, mode: BumpMode): Promise<void> {
  await tx.execute(sql`update locations set bump_mode = ${mode} where id = ${cfg.locationId}`);
}

export async function getBumpMode(tx: Transaction, cfg: TillConfig): Promise<BumpMode> {
  const { rows } = await tx.execute<{ bump_mode: BumpMode }>(
    sql`select bump_mode from locations where id = ${cfg.locationId}`,
  );
  return rows[0]!.bump_mode;
}

/** Which surface shows the per-course fire action. It governs only the UI. The dashboard and till keep hand-written copies of this union, because the
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
 * Move an active course to index `to` of {@link listCourses}' order (past the end means last), and
 * renumber every active course's `displayOrder` to its index. An absent, inactive or other venue's
 * id throws `course.not_found`.
 */
export async function moveCourse(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  to: number,
): Promise<Course[]> {
  const courses = await listCourses(tx, cfg);
  const from = courses.findIndex((course) => course.id === id);
  if (from === -1) {
    throw new AppError("course.not_found", { courseId: id });
  }
  const [moving] = courses.splice(from, 1);
  courses.splice(Math.min(to, courses.length), 0, moving!);
  for (const [index, course] of courses.entries()) {
    if (course.displayOrder !== index) {
      await tx
        .update(kitchenCourses)
        .set({ displayOrder: index })
        .where(eq(kitchenCourses.id, course.id));
      course.displayOrder = index;
    }
  }
  return courses;
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
