// Side-effect only: keeps this host's `station.*`/`course.*` codes (errors.ts) reachable from the file
// that throws them — the reachability convention tables.ts/till-sale.ts follow. See errors.ts.
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
import type { TillConfig } from "./till-config.js";

// KDS-1 (design §3a) station config + routing verbs. Config only — plain inserts / by-id UPDATEs
// on the caller's transaction under its tenant/app_user scope; the `till.configure` gate is
// applied at the ROUTE layer (Task 7, the layout-routes model), exactly as the FP-1 zone/table
// verbs in tables.ts rely on the route's authorizeManager rather than gating inside the verb.
// Deliberately imports nothing from working-order.ts — the `order_prep` rework (Tasks 3/4/6)
// leaves that module broken mid-branch.

/** A configured kitchen station as the CRUD surface returns it — the slim shape the config editor and
 *  the station picker both read. `createdAt` is INTERNAL, not part of this surface (the same choice
 *  tables.ts's {@link FloorZone} makes for its own `createdAt`). The three `*AfterMinutes` fields (KDS
 *  order-timing alerts, design §8) ride this same read so the dashboard's threshold editor
 *  (`kitchen-screen.ts`) can SEED its form from the row's persisted values rather than always
 *  re-showing the column defaults — {@link updateStation}'s own doc explains why the CHECK ordering is
 *  never re-validated on this read side. */
export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  /** The venue's single fallback station (the counter/pass), enforced by the `WHERE is_default` partial
   *  unique. Written only by {@link setDefaultStation} / {@link createStation}, never a plain update. */
  isDefault: boolean;
  active: boolean;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

/**
 * The deployment holds one tenant per database. Assert `stationId` names a LIVE station of THIS
 * venue — present, `active`, and in `cfg.locationId`. NULL-or-false → `station.not_found`,
 * folding "absent / another venue's" and "deactivated" into the one code (errors.ts explains why
 * the inactive case is not distinct). The tenant-consistent
 * `categories_station_fk`/`products_station_fk` (and the default's own scope) enforce only
 * same-TENANT existence — they can see neither `active` nor the location — so this explicit read
 * is what rejects a retired or cross-venue station the FK would accept. One round trip via a
 * scalar subquery, the shape tables.ts's `setTableStatus` uses; the `location_id` predicate
 * narrows it to this venue.
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
 * Clear the venue's current default station (`is_default = false` on the one `is_default` row of
 * `cfg.locationId`, if any). Shared by {@link setDefaultStation} and {@link createStation}: the partial
 * unique `kitchen_stations_default_key` (one default per location) tolerates no two defaults even
 * momentarily, so a new default is always CLEAR-then-SET, and clearing first is what keeps the two from
 * ever coexisting within the statement pair (setting first would trip 23505 at the statement boundary).
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
 * Create a kitchen station in the till's venue (its `cfg.locationId`), returning the minted id. A
 * duplicate `(tenant, location, name)` collides on `kitchen_stations_name_key` and is surfaced as
 * `station.name_taken` rather than the raw 23505 — the same shape tables.ts's `createZone` maps
 * `zone.name_taken` with. Marking the station default ADOPTS it as THE default: it clears any prior
 * default first (in this same tx), exactly as {@link setDefaultStation} does — so WITHIN one tx the
 * partial-default unique (`kitchen_stations_default_key`) is not reachable and the expected 23505 is the
 * name key. The one exception is two CONCURRENT `createStation({isDefault:true})` in the same venue:
 * each clears then inserts `is_default=true`, and the second to commit trips the default partial-unique,
 * which this catch would ALSO surface as `station.name_taken` (a mislabel). Cosmetic — a gated admin
 * verb, a remote race, still a 4xx — so the catch is left undiscriminated rather than splitting on the
 * constraint name (the receipt discipline CLAUDE.md §1/§3 asks for).
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
        tenantId: cfg.tenantId,
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

/**
 * The venue's ACTIVE stations, by `display_order` then `name`. The deployment holds one tenant
 * per database. The location filter narrows to this till's venue — the same active-only,
 * location-scoped shape tables.ts's {@link listZones} uses (a deactivated station is not a
 * routing/display target).
 */
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
 * Edit a station's `name`/`displayOrder`/`active`/timing-thresholds (any subset) — NOT
 * `is_default`, which only {@link setDefaultStation} may flip (so the partial unique is never
 * risked by a plain update). Reactivation is `updateStation({ active: true })`, the
 * `update`-shaped surface tables.ts's {@link updateZone} uses. An absent id throws
 * `station.not_found`; a name collision throws `station.name_taken`. The three `*AfterMinutes`
 * fields (KDS order-timing alerts, design §8) are validated by the ROUTE before this is called —
 * positive integers with `warm < overdue < forgotten` — so the raw
 * `kitchen_stations_thresholds_ordered` CHECK (23514) is never reachable from here; this verb
 * only forwards whatever the caller already validated, the same division of labour
 * `name`/`displayOrder` already have with their route-side screens.
 */
export async function updateStation(
  tx: Transaction,
  // The deployment holds one tenant per database. Kept for a uniform `(tx, cfg, …)` verb surface;
  // this update filters by id, so the config is unused here (the repo idiom for an
  // interface-mandated unused param — see tables.ts's updateZone).
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

/** Deactivate a station (`active = false`) — never a hard delete (a `ticket_items.station_id` snapshot
 *  may reference it; app_user holds no DELETE on `kitchen_stations`). An absent id throws
 *  `station.not_found`. `is_default` is left as-is: the row keeps the default slot until another station
 *  is made default (which clears it). No live routing lands on a deactivated default — `fireLines`'
 *  fallback query requires `is_default AND active`, and {@link setDefaultStation} refuses a deactivated
 *  target — so deactivating the venue's ONLY default leaves it with no ACTIVE default and firing then
 *  fails loud with `station.no_default` (§2b), NOT silent misrouting to a dead station, until a new
 *  default is set. */
export async function deactivateStation(
  tx: Transaction,
  // Unused here for the same reason as {@link updateStation} — kept for the uniform verb surface.
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
 * Make station `id` the venue's single default (the counter/pass fallback). The target must be a LIVE
 * station of this venue (else `station.not_found`, {@link requireLiveStation}) — a retired or foreign
 * station cannot be the fallback, and the check runs BEFORE any write so a bad id never clears the
 * existing default. Then CLEAR the prior default and SET the new one — two statements in the caller's
 * one tx. The partial unique `kitchen_stations_default_key` is checked at each statement boundary, so
 * clearing first means the two defaults never coexist (setting first would trip 23505). Idempotent when
 * `id` is already the default: the clear unsets it, the set restores it.
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
 * The deployment holds one tenant per database. Set (or clear, with `null`) a category's DEFAULT
 * routing station (KDS-1 §2b) — the category-level route a fired line falls to when its product
 * names no override. A non-null `stationId` must be a LIVE station of this venue ({@link
 * requireLiveStation}, `station.not_found` otherwise); clearing (null) skips the check, the shape
 * tables.ts's `setTableStatus` uses for a null status. The UPDATE is by category id in this
 * database (categories have no location column): an absent `categoryId` matches no row and is a
 * no-op — the route layer (Task 7) resolves category ids against the catalogue surface, and KDS-1
 * mints no `category.not_found` (spec §6 enumerates only the three `station.*` codes +
 * `ticket.*`).
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
 * The deployment holds one tenant per database. Set (or clear, with `null`) a product's OVERRIDE
 * routing station (KDS-1 §2b) — the per-product route that wins over its category default. Same
 * shape as {@link setCategoryStation}: a non-null `stationId` must be a LIVE station of this
 * venue (`station.not_found` otherwise), null clears it, and the UPDATE is by product id in this
 * database (an absent `productId` is a no-op — the route layer resolves product ids, and KDS-1
 * mints no `product.not_found`).
 */
export async function setProductStation(
  tx: Transaction,
  cfg: TillConfig,
  productId: string,
  stationId: string | null,
): Promise<void> {
  if (stationId !== null) {
    await requireLiveStation(tx, cfg, stationId);
  }
  await tx.update(products).set({ stationId }).where(eq(products.id, productId));
}

/** The KDS-1 whole-ticket bump mode (§2e). `line` = per-line bump only; `ticket` = the station display
 *  ALSO offers a whole-ticket "bump all". The per-line ticket-item state is always the source of truth;
 *  this flag governs only the display convenience. Mirrors `locations.bump_mode`'s pgEnum
 *  (`packages/db/src/schema/tenants.ts`), spelled as a literal union here because `@waitron/db`'s
 *  enumerated exports do NOT publish the `bumpMode` enum object (CLAUDE.md §3). */
export type BumpMode = "line" | "ticket";

/**
 * Set the venue's whole-ticket bump mode (KDS-1 §2e) — a single per-location flag on
 * `locations.bump_mode` (`line` default / `ticket`), scoped to `cfg.locationId` in the database
 * holding this tenant. Written via a parameterised `sql` update rather than a Drizzle
 * `.update(locations)` because `@waitron/db`'s enumerated exports map does NOT publish the
 * `locations` table object (CLAUDE.md §3) — the same raw-`sql` shape the `order_flow` flip uses
 * in the till suites. `mode` is a typed `BumpMode`, so the value reaching the enum column is
 * always one of its two members (the route validates the request field before calling); `${mode}`
 * binds as a parameter (never string-concatenated) and PostgreSQL coerces it to the `bump_mode`
 * enum in the assignment context. `till.configure`-gated at the ROUTE (Task 7), as the other
 * config verbs are.
 */
export async function setBumpMode(tx: Transaction, cfg: TillConfig, mode: BumpMode): Promise<void> {
  await tx.execute(sql`update locations set bump_mode = ${mode} where id = ${cfg.locationId}`);
}

/** The KDS-2/3 fire-control venue setting (§2c). `waiter` (default) = the tab-ordering screen surfaces the
 *  per-course fire action; `kitchen` = the station display surfaces it; `expo` (KDS-3) = the expo/pass
 *  display surfaces it. Governs only which UI shows the button — `fireCourse` is the same either way, and
 *  every surface is session-gated. DERIVED from `@waitron/db`'s `fireControlMode` pgEnum (which backs
 *  `locations.fire_control`, `packages/db/src/schema/tenants.ts`) so the two can never drift — add a mode
 *  to the enum and this widens with it, exactly as the sibling {@link OrderFlow}/`TicketState` server types
 *  derive from `orderFlow`/`ticketState`. The RUNTIME `fire-control` route validator derives its valid set
 *  from the SAME `fireControlMode.enumValues`. The dashboard/till CLIENT types keep a hand-maintained
 *  literal mirror instead, because the browser bundle cannot import `@waitron/db` to derive it — so a
 *  server-ahead enum addition is NOT caught at the client automatically (a stale client mirror only fails
 *  to typecheck if the client itself references the unlisted mode); add a mode to each client mirror by
 *  hand. */
export type FireControl = (typeof fireControlMode.enumValues)[number];

/**
 * Read the venue's fire-control setting (`locations.fire_control`), scoped to `cfg.locationId` in
 * the database holding this tenant. The read counterpart of {@link setFireControl}, for the
 * dashboard config surface's toggle (spec §3a: the setting is read AND written with the other
 * venue config). Read via a parameterised `sql` select via a parameterised `sql` select — the
 * house shape the sibling venue-config verbs ({@link setBumpMode}) use for these single-column
 * `locations` read/writes. (A Drizzle `.select(locations)` is available too: `@waitron/db`'s
 * barrel DOES re-export `locations`, imported at e.g. till-api.ts:5 — the raw `sql` is a style
 * choice, not a necessity.) The column is `NOT NULL DEFAULT 'waiter'`, so a row always yields one
 * of its enum members.
 */
export async function getFireControl(tx: Transaction, cfg: TillConfig): Promise<FireControl> {
  const { rows } = await tx.execute<{ fire_control: FireControl }>(
    sql`select fire_control from locations where id = ${cfg.locationId}`,
  );
  return rows[0]!.fire_control;
}

/**
 * Set the venue's fire-control setting (`locations.fire_control`, `waiter` default / `kitchen`),
 * scoped to `cfg.locationId` in the database holding this tenant. The exact shape of {@link
 * setBumpMode}: a parameterised `sql` update — the house style for these single-column
 * `locations` config writes (a Drizzle `.update(locations)` is available too; `@waitron/db`'s
 * barrel re-exports `locations`, so raw `sql` is a choice, not a necessity). `mode` is a typed
 * {@link FireControl}, so the value reaching the enum column is always one of its members (the
 * route validates the request field before calling); `${mode}` binds as a parameter (never
 * string-concatenated) and PostgreSQL coerces it to the `fire_control_mode` enum in the
 * assignment context. `till.configure`-gated at the ROUTE (Task 5), as the other config verbs
 * are.
 */
export async function setFireControl(
  tx: Transaction,
  cfg: TillConfig,
  mode: FireControl,
): Promise<void> {
  await tx.execute(sql`update locations set fire_control = ${mode} where id = ${cfg.locationId}`);
}

// ── KDS-2 kitchen courses (design §2a/§3a) ───────────────────────────────────────────────────────
// Config verbs mirroring the station-config verbs above, minus the default concept: `kitchen_courses`
// has no `is_default` (a null course simply fires earliest, spec §2b), so there is no clear-then-set
// dance and no partial unique to protect. Same shape otherwise — plain inserts / by-id UPDATEs on the
// caller's transaction under its tenant/app_user scope, `course.name_taken` on a duplicate
// `(tenant, location, name)` and `course.not_found` for an id this venue may not reach; the
// `till.configure` gate is applied at the ROUTE layer (Task 5), exactly as the station verbs rely on.

/** A configured kitchen course as the CRUD surface returns it — the slim shape the Cursos config editor
 *  and the course picker both read. `createdAt` is INTERNAL, not part of this surface (the same choice
 *  {@link Station} makes for its own `createdAt`). No `isDefault`: courses have no default (spec §2b). */
export interface Course {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * Assert `courseId` names a LIVE course of THIS venue — present, `active`, and in
 * `cfg.locationId`. NULL-or-false → `course.not_found`, folding "absent / another venue's" and
 * "deactivated" into the one code (errors.ts explains why the inactive case is not distinct),
 * exactly as {@link requireLiveStation} does for a station. The tenant-consistent
 * `products_course_fk` enforces only same-TENANT existence — it can see neither `active` nor the
 * location — so this explicit read is what rejects a retired or cross-venue course the FK would
 * accept. One round trip via a scalar subquery.
 *
 * Exported so `fireCourse` (working-order.ts) validates the fired course against the SAME `course.not_found`
 * definition the config verbs use — one meaning of "not a live course", not a second copy that could drift.
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
 * Assert `courseId` names a course that EXISTS in THIS venue — present and in `cfg.locationId`,
 * whether `active` or not. The existence-only sibling of {@link requireLiveCourse}: it drops the
 * `active` gate so a DEACTIVATED course still passes, folding only "absent / another venue's"
 * into `course.not_found`. `kitchen_courses.active` is `NOT NULL`, so the scalar subquery yields
 * NULL only when NO row of this venue matches — that NULL is the sole "not found" signal, and a
 * present row (`true` OR `false`) passes.
 *
 * Used by `fireCourse` (working-order.ts): a course deactivated WHILE it holds items must stay fireable —
 * the held items already carry the `course_id` snapshot, so releasing them must not need the course still
 * OFFERED, only still real. The config/override paths ({@link setProductCourse}, the A1 ring-time
 * override screen) keep {@link requireLiveCourse}, which additionally rejects an inactive course — a
 * retired course is not a valid NEW routing target, but its already-held food is.
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

/**
 * Create a kitchen course in the till's venue (its `cfg.locationId`), returning the minted id. A
 * duplicate `(tenant, location, name)` collides on `kitchen_courses_name_key` and is surfaced as
 * `course.name_taken` rather than the raw 23505 — the same shape {@link createStation} maps
 * `station.name_taken` with. Simpler than `createStation`: no default to adopt, so no clear-then-set.
 */
export async function createCourse(
  tx: Transaction,
  cfg: TillConfig,
  input: { name: string; displayOrder?: number },
): Promise<{ id: string }> {
  try {
    const [row] = await tx
      .insert(kitchenCourses)
      .values({
        tenantId: cfg.tenantId,
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

/**
 * The venue's ACTIVE courses, by `display_order` then `name` — the coursing SEQUENCE (spec §2a:
 * lowest display_order fires first). The deployment holds one tenant per database. The location
 * filter narrows to this till's venue — the same active-only, location-scoped shape {@link
 * listStations} uses.
 */
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
 * Edit a course's `name`/`displayOrder`/`active` (any subset). Reactivation is `updateCourse({
 * active: true })`, the `update`-shaped surface {@link updateStation} uses. An absent id throws
 * `course.not_found`; a name collision throws `course.name_taken`.
 */
export async function updateCourse(
  tx: Transaction,
  // The deployment holds one tenant per database. Kept for a uniform `(tx, cfg, …)` verb surface;
  // this update filters by id, so the config is unused here (the repo idiom for an
  // interface-mandated unused param — see {@link updateStation}).
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

/** Deactivate a course (`active = false`) — never a hard delete (a `ticket_items.course_id` snapshot may
 *  reference it; app_user holds no DELETE on `kitchen_courses`). An absent id throws `course.not_found`.
 *  Mirrors {@link deactivateStation}. */
export async function deactivateCourse(
  tx: Transaction,
  // Unused here for the same reason as {@link updateCourse} — kept for the uniform verb surface.
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
 * The deployment holds one tenant per database. Set (or clear, with `null`) a product's DEFAULT
 * kitchen course (KDS-2 §2b) — the per-product course a line falls to at ring time when the line
 * carries no override. Same shape as {@link setProductStation}: a non-null `courseId` must be a
 * LIVE course of this venue ({@link requireLiveCourse}, `course.not_found` otherwise), null
 * clears it, and the UPDATE is by product id in this database (an absent `productId` is a no-op —
 * the route layer resolves product ids, and KDS-2 mints no `product.not_found`).
 */
export async function setProductCourse(
  tx: Transaction,
  cfg: TillConfig,
  productId: string,
  courseId: string | null,
): Promise<void> {
  if (courseId !== null) {
    await requireLiveCourse(tx, cfg, courseId);
  }
  await tx.update(products).set({ courseId }).where(eq(products.id, productId));
}
