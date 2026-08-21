// Side-effect only: keeps this host's `table.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention `till-config.ts`/`till-sale.ts` follow. See errors.ts.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { authorizeManager } from "@waitron/identity";
import {
  diningTables,
  floorTableShape,
  floorZones,
  isUniqueViolation,
  tableServiceStatuses,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";

const FOREIGN_KEY_VIOLATION = "23503";
const ZONE_FK = "dining_tables_zone_fk";

/**
 * The rendered shape of a table on the FP-2 floor plan, DERIVED from the `floor_table_shape` schema
 * enum rather than hand-re-declared as a string union — so this and the DB stay in lockstep if a
 * member is ever added/removed (the same derive-don't-duplicate shape `till-config.ts`'s `OrderFlow`
 * and `working-order.ts`'s `PrepState` use). `working-order.ts`'s `TableState` imports this for the
 * read side, so the write verb and the read model share one source of truth.
 */
export type FloorTableShape = (typeof floorTableShape.enumValues)[number];

/** The inclusive canvas-coordinate bound (design §placement: `pos_x`/`pos_y` are 0..1000). */
const COORD_MAX = 1000;
/** The inclusive rotation bound in degrees (design §placement: `rotation` is 0..359). */
const ROTATION_MAX = 359;

/**
 * Refuse a placement number that is not an integer in `[0, max]`, naming the FIELD (never the value —
 * the no-leak discipline `placement.invalid` documents). Shared by `posX`/`posY`/`rotation` so the
 * three field guards read and reject identically.
 */
function requirePlacementInt(value: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new AppError("placement.invalid", { field });
  }
}

/**
 * Is this (or anything it wraps) a foreign-key violation on `dining_tables_zone_fk` — a `zone_id`
 * naming no `floor_zones` row for this tenant (a missing zone, or another tenant's, which the
 * tenant-consistent composite FK rejects too)? Walks the cause chain because Drizzle wraps every
 * failed query in a `DrizzleQueryError` whose own `.code` is undefined; the real SQLSTATE and the
 * `.constraint` name live on `.cause` (node-postgres), one level deeper still under PGlite — verified
 * against this file's PGlite suite, where the 23503 arrives at depth 1 with `constraint =
 * "dining_tables_zone_fk"`. Stops at a fixed depth so a self-referential `cause` cannot spin forever.
 * Reads the CONSTRAINT NAME, not just the 23503 code, so the sibling `dining_tables_location_fk` /
 * `dining_tables_status_fk` violations are deliberately NOT matched — a bad location or status is not
 * a zone fault and stays a raw driver error. Mirrors `@waitron/db`'s `isUniqueViolation` and
 * `@waitron/reporting`'s `isBusinessDayConflict` shape (the latter extends the same walk with a
 * constraint check for the identical reason). Exported for the crafted-error unit tests.
 */
export function isZoneFkViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      (current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION &&
      (current as { constraint?: unknown }).constraint === ZONE_FK
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}

/** A dining table as the CRUD surface returns it. `createdAt` is an ISO string. The `tab_id` back-pointer
 *  is an INTERNAL link (design §2b), not part of the CRUD surface — occupancy exposes it, not this. */
export interface DiningTable {
  id: string;
  label: string;
  /** The `floor_zones` row this table sits in (FP-1), or null. The successor to the former free-text
   *  `zone` string — a composite FK (`dining_tables_zone_fk`), not an arbitrary label. */
  zoneId: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
  /** FP-2 spatial placement on the floor-plan canvas — canvas coordinates, rendered shape, and rotation
   *  in degrees, or `null` for an unplaced table. Written by {@link setTablePlacement} /
   *  {@link clearPlacement}. Non-optional `| null` (unconditionally present, `null` when unplaced),
   *  mirroring `working-order.ts`'s `TableState` placement block so the dashboard editor reads a
   *  placement field without a presence check and keeps a placed table placed on reload. */
  posX: number | null;
  posY: number | null;
  shape: FloorTableShape | null;
  rotation: number | null;
}

/**
 * Create a dining table in the till's venue (its `cfg.locationId`), returning the minted id. Runs on the
 * CALLER's transaction under its tenant/app_user scope. A duplicate `(tenant, location, label)` collides
 * on `dining_tables_location_label_key` (the only unique an INSERT can trip — `id` is fresh) and is
 * surfaced as `table.label_taken` rather than the raw 23505. A `zoneId` naming no `floor_zones` row
 * (or another tenant's) trips the composite `dining_tables_zone_fk` (23503) and is surfaced as
 * `zone.not_found` — the location FK is a 23503 too, so the check reads the CONSTRAINT NAME
 * (`isZoneFkViolation`) rather than the bare code.
 */
export async function createTable(
  tx: Transaction,
  cfg: TillConfig,
  input: { label: string; zoneId?: string; capacity?: number },
): Promise<{ id: string }> {
  try {
    const [row] = await tx
      .insert(diningTables)
      .values({
        tenantId: cfg.tenantId,
        locationId: cfg.locationId,
        label: input.label,
        zoneId: input.zoneId ?? null,
        capacity: input.capacity ?? null,
      })
      .returning({ id: diningTables.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("table.label_taken", { label: input.label });
    }
    if (isZoneFkViolation(error)) {
      // The zone FK only fires when a non-null `zoneId` was supplied, so it is defined here.
      throw new AppError("zone.not_found", { zoneId: input.zoneId! });
    }
    throw error;
  }
}

/** The venue's ACTIVE tables, by `label`. RLS confines the read to the tenant; the location filter
 *  narrows to this till's venue. */
export async function listTables(tx: Transaction, cfg: TillConfig): Promise<DiningTable[]> {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zoneId: diningTables.zoneId,
      capacity: diningTables.capacity,
      active: diningTables.active,
      createdAt: diningTables.createdAt,
      posX: diningTables.posX,
      posY: diningTables.posY,
      shape: diningTables.shape,
      rotation: diningTables.rotation,
    })
    .from(diningTables)
    .where(and(eq(diningTables.locationId, cfg.locationId), eq(diningTables.active, true)))
    .orderBy(diningTables.label);
}

/**
 * Edit a table's `label`/`zoneId`/`capacity` (any subset). An absent id (or another tenant's, RLS-hidden)
 * throws `table.not_found`; a label collision throws `table.label_taken`; a `zoneId` naming no
 * `floor_zones` row (or another tenant's) throws `zone.not_found` (the composite `dining_tables_zone_fk`,
 * `isZoneFkViolation`). Reactivate is `updateTable`-shaped and kept trivial — this task deactivates via
 * {@link deactivateTable}.
 */
export async function updateTable(
  tx: Transaction,
  // Kept for a uniform `(tx, cfg, …)` verb surface; this by-id update relies on RLS for the tenant
  // scope, so the config is unused here (repo idiom for an interface-mandated unused param).
  _cfg: TillConfig,
  id: string,
  input: { label?: string; zoneId?: string; capacity?: number },
): Promise<void> {
  const patch: { label?: string; zoneId?: string | null; capacity?: number | null } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.zoneId !== undefined) patch.zoneId = input.zoneId;
  if (input.capacity !== undefined) patch.capacity = input.capacity;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(diningTables)
      .set(patch)
      .where(eq(diningTables.id, id))
      .returning({ id: diningTables.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `label` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("table.label_taken", { label: input.label! });
    }
    if (isZoneFkViolation(error)) {
      // The zone FK only fires when a non-null `zoneId` was supplied, so it is defined here.
      throw new AppError("zone.not_found", { zoneId: input.zoneId! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}

/** Deactivate a table (`active = false`) — never a hard delete (the table has order history; app_user
 *  holds no DELETE on `dining_tables`). An absent id throws `table.not_found`. */
export async function deactivateTable(
  tx: Transaction,
  // Unused here for the same reason as `updateTable` — kept for the uniform verb surface.
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(diningTables)
    .set({ active: false })
    .where(eq(diningTables.id, id))
    .returning({ id: diningTables.id });
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}

/**
 * Place a table on the FP-2 spatial floor plan (design §placement): write its zone + canvas
 * coordinates + shape + rotation. Runs on the CALLER's transaction under its tenant/app_user scope.
 * LOCATION-scoped to `cfg.locationId` (like the sibling read {@link listTables}): RLS confines every
 * read/write to the tenant, but a tenant can hold several venues, so both the table and the zone must
 * belong to THIS venue — a caller supplying another location's table or zone UUID is refused, not
 * allowed to reach across venues. Validates IN ORDER, each with its own precise code:
 *  1. the table is ACTIVE and in this LOCATION (an absent, deactivated, foreign/RLS-hidden, or
 *     cross-location row → `table.not_found`, the same "must be active" shape {@link setTableStatus}
 *     enforces);
 *  2. the `zoneId` is a LIVE zone of this LOCATION — present, `active`, and `location_id =
 *     cfg.locationId` (else `zone.not_found`; an inactive/absent/foreign/cross-location zone folds into
 *     the one code, matching the spec's "a live zone"). The `dining_tables_zone_fk`
 *     {@link createTable}/{@link updateTable} lean on is (tenant, zone) only — it can see neither
 *     `active` nor the location — so this is an explicit read rather than a caught FK violation;
 *  3. `posX`/`posY` integer in `0..1000`, `shape` in the `floor_table_shape` enum, `rotation` integer
 *     in `0..359` — each failure is `placement.invalid` naming THAT field, never the value.
 * Steps 1–2 are ONE round trip (two scalar subqueries, NULL when no row matches), the shape
 * {@link setTableStatus} uses. Only then does it UPDATE the four placement columns plus `zone_id`,
 * itself re-scoped to (id, location) so a zero-row UPDATE (the table is not this venue's) is
 * `table.not_found` rather than a silent no-op.
 */
export async function setTablePlacement(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  p: { zoneId: string; posX: number; posY: number; shape: FloorTableShape; rotation: number },
): Promise<void> {
  // One round trip: the table's `active` flag and the target zone's `active` flag, each NULL when no
  // row matches (RLS confines both reads to this tenant; the `location_id` predicate narrows each to
  // THIS venue). NULL-or-false distinguishes missing from inactive but both map to the one code here —
  // a placement needs a live table AND a live zone, both in this location.
  const { rows } = await tx.execute<{
    table_active: boolean | null;
    zone_active: boolean | null;
  }>(
    sql`select
      (select ${diningTables.active} from ${diningTables} where ${diningTables.id} = ${tableId} and ${diningTables.locationId} = ${cfg.locationId}) as table_active,
      (select ${floorZones.active} from ${floorZones} where ${floorZones.id} = ${p.zoneId} and ${floorZones.locationId} = ${cfg.locationId}) as zone_active`,
  );
  const row = rows[0]!;
  if (!row.table_active) {
    throw new AppError("table.not_found", { tableId });
  }
  if (!row.zone_active) {
    throw new AppError("zone.not_found", { zoneId: p.zoneId });
  }

  requirePlacementInt(p.posX, COORD_MAX, "posX");
  requirePlacementInt(p.posY, COORD_MAX, "posY");
  if (!floorTableShape.enumValues.includes(p.shape)) {
    throw new AppError("placement.invalid", { field: "shape" });
  }
  requirePlacementInt(p.rotation, ROTATION_MAX, "rotation");

  const updated = await tx
    .update(diningTables)
    .set({ zoneId: p.zoneId, posX: p.posX, posY: p.posY, shape: p.shape, rotation: p.rotation })
    .where(and(eq(diningTables.id, tableId), eq(diningTables.locationId, cfg.locationId)))
    .returning({ id: diningTables.id });
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId });
  }
}

/**
 * Remove a table from the floor plan: NULL the four placement columns (`pos_x`/`pos_y`/`shape`/
 * `rotation`). `zone_id` is left AS-IS — it is an FP-1 assignment, not one of the four placement
 * columns, and a table may belong to a zone without being spatially placed. LOCATION-scoped to
 * `cfg.locationId` (like {@link setTablePlacement} and the sibling read {@link listTables}): an absent
 * id, another tenant's (RLS-hidden), or another VENUE's (same tenant, different `location_id`) matches
 * no row and throws `table.not_found`, the by-id shape {@link updateTable}/{@link deactivateTable} use.
 * No `active` check — like those two, `clearPlacement` operates on the row regardless of its `active`
 * flag.
 */
export async function clearPlacement(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<void> {
  const updated = await tx
    .update(diningTables)
    .set({ posX: null, posY: null, shape: null, rotation: null })
    .where(and(eq(diningTables.id, tableId), eq(diningTables.locationId, cfg.locationId)))
    .returning({ id: diningTables.id });
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId });
  }
}

/** A floor-plan zone (FP-1) as the config CRUD surface returns it — the authorable successor to the
 *  former free-text `dining_tables.zone`. `createdAt` is INTERNAL, not part of this surface (the same
 *  choice {@link DiningTable}'s `tab_id` back-pointer makes). */
export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * Create a floor-plan zone in the till's venue (its `cfg.locationId`), returning the minted id. Runs on
 * the CALLER's transaction under its tenant/app_user scope. A duplicate `(tenant, location, name)`
 * collides on `floor_zones_name_key` (the only unique an INSERT can trip — `id` is fresh) and is
 * surfaced as `zone.name_taken` rather than the raw 23505 — the same shape {@link createTable} maps
 * `table.label_taken` with.
 */
export async function createZone(
  tx: Transaction,
  cfg: TillConfig,
  input: { name: string; displayOrder?: number },
): Promise<{ id: string }> {
  try {
    const [row] = await tx
      .insert(floorZones)
      .values({
        tenantId: cfg.tenantId,
        locationId: cfg.locationId,
        name: input.name,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: floorZones.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("zone.name_taken", { name: input.name });
    }
    throw error;
  }
}

/** The venue's ACTIVE zones, by `display_order`. RLS confines the read to the tenant; the location
 *  filter narrows to this till's venue. */
export async function listZones(tx: Transaction, cfg: TillConfig): Promise<FloorZone[]> {
  return tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      displayOrder: floorZones.displayOrder,
      active: floorZones.active,
    })
    .from(floorZones)
    .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)))
    .orderBy(floorZones.displayOrder);
}

/**
 * Edit a zone's `name`/`displayOrder`/`active` (any subset). An absent id (or another tenant's,
 * RLS-hidden) throws `zone.not_found`; a name collision throws `zone.name_taken`. Reactivate is
 * `updateZone({ active: true })` — the same `update`-shaped surface {@link updateTable} uses, so this
 * task deactivates via {@link deactivateZone} and never hard-deletes.
 */
export async function updateZone(
  tx: Transaction,
  // Kept for a uniform `(tx, cfg, …)` verb surface; this by-id update relies on RLS for the tenant
  // scope, so the config is unused here (repo idiom for an interface-mandated unused param).
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
      .update(floorZones)
      .set(set)
      .where(eq(floorZones.id, id))
      .returning({ id: floorZones.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `name` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("zone.name_taken", { name: patch.name! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("zone.not_found", { zoneId: id });
  }
}

/** Deactivate a zone (`active = false`) — never a hard delete (a `dining_tables.zone_id` may reference
 *  it; app_user holds no DELETE on `floor_zones`). An absent id throws `zone.not_found`. */
export async function deactivateZone(
  tx: Transaction,
  // Unused here for the same reason as `updateZone` — kept for the uniform verb surface.
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(floorZones)
    .set({ active: false })
    .where(eq(floorZones.id, id))
    .returning({ id: floorZones.id });
  if (updated.length === 0) {
    throw new AppError("zone.not_found", { zoneId: id });
  }
}

/** A configured service status as the CRUD surface returns it. `createdAt` is an ISO string. */
export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

// A floor-plan swatch is a hex ("#ef4444") or a short token ("amber", "amber-500"): a bounded,
// charset-restricted string. Validated app-side (design §2a) — the DB stores opaque text. A malformed
// value is a request-payload fault surfaced as `management.request_invalid` naming the FIELD (never the
// value — the no-leak discipline errors.ts states), the same shape the layout PUT route uses; the spec
// enumerates only status.not_found/inactive/label_taken, so no new status.* code is minted (Plan note 3).
const STATUS_COLOR_RE = /^[#A-Za-z0-9_-]{1,32}$/;
function validateStatusColor(color: string): string {
  if (typeof color !== "string" || !STATUS_COLOR_RE.test(color)) {
    throw new AppError("management.request_invalid", { field: "color" });
  }
  return color;
}

/**
 * The `till.configure` gate the four status config-CRUD verbs share (design §3a): manager/admin only
 * (the #81 venue-config permission — reused, not renamed), run BEFORE any DB write, proven by-deletion
 * in the suite. Extracted so the one gate is stated once across create/list/update/deactivate.
 */
async function requireConfigure(tx: Transaction, managementSessionId: string): Promise<void> {
  await authorizeManager(tx, { managementSessionId, permission: "till.configure" });
}

/**
 * Create a service status in the tenant's configured set. Manager/admin only (`till.configure`, the
 * #81 venue-config permission — reused, not renamed): the authorize gate runs BEFORE any DB write,
 * proven by-deletion in the suite. A duplicate `(tenant, label)` collides on
 * `table_service_statuses_tenant_label_key` and is surfaced as `status.label_taken`.
 */
export async function createStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    label: string;
    color: string;
    displayOrder?: number;
  },
): Promise<{ id: string }> {
  await requireConfigure(tx, input.managementSessionId);
  const color = validateStatusColor(input.color);
  try {
    const [row] = await tx
      .insert(tableServiceStatuses)
      .values({
        tenantId: input.tenantId,
        label: input.label,
        color,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: tableServiceStatuses.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("status.label_taken", { label: input.label });
    }
    throw error;
  }
}

/** A pickable ACTIVE service status for the till's Estado picker (FP-1) — the slim `{ id, label, color }`
 *  the floor-plan picker needs, DISTINCT from the config-CRUD {@link ServiceStatus} (which also carries
 *  `displayOrder`/`active`/`createdAt` for the editor). */
export interface ServiceStatusOption {
  id: string;
  label: string;
  color: string;
}

/**
 * The tenant's ACTIVE service statuses as pickable options for the till's Estado picker (FP-1) —
 * `{ id, label, color }` only, ordered by `display_order` then `label`. Deactivated statuses are EXCLUDED
 * (`active = true`): a status the operator cannot apply (`setTableStatus` rejects `status.inactive`) must
 * not be offered. SESSION-gated at the route — NOT `requireConfigure`, unlike the manager-only
 * {@link listStatuses}: an operator holds a till session, not a management one, so it takes no
 * `managementSessionId`. Takes NO `cfg`: the statuses table is tenant-wide with no location column, so
 * RLS (`asAppUser` under `withTenant`) is the whole scope — there is nothing to narrow by, unlike
 * {@link listZones}'s location filter.
 */
export async function listServiceStatuses(tx: Transaction): Promise<ServiceStatusOption[]> {
  return tx
    .select({
      id: tableServiceStatuses.id,
      label: tableServiceStatuses.label,
      color: tableServiceStatuses.color,
    })
    .from(tableServiceStatuses)
    .where(eq(tableServiceStatuses.active, true))
    .orderBy(tableServiceStatuses.displayOrder, tableServiceStatuses.label);
}

/**
 * The tenant's WHOLE status set — active AND inactive, ordered by `display_order` then `label` — so the
 * editor can reactivate a deactivated one. Manager/admin only (`till.configure`), gated here rather than
 * at the route so the verb is safe from any caller. RLS confines the read to the tenant.
 */
export async function listStatuses(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string },
): Promise<ServiceStatus[]> {
  await requireConfigure(tx, input.managementSessionId);
  return tx
    .select({
      id: tableServiceStatuses.id,
      label: tableServiceStatuses.label,
      color: tableServiceStatuses.color,
      displayOrder: tableServiceStatuses.displayOrder,
      active: tableServiceStatuses.active,
      createdAt: tableServiceStatuses.createdAt,
    })
    .from(tableServiceStatuses)
    .orderBy(tableServiceStatuses.displayOrder, tableServiceStatuses.label);
}

/**
 * Edit a status's `label`/`color`/`displayOrder`/`active` (any subset). Manager/admin only
 * (`till.configure`). An absent id (or another tenant's, RLS-hidden) throws `status.not_found`; a label
 * collision throws `status.label_taken`; a malformed color throws `management.request_invalid`.
 * Reactivation is `updateStatus({ active: true })`.
 */
export async function updateStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    id: string;
    label?: string;
    color?: string;
    displayOrder?: number;
    active?: boolean;
  },
): Promise<void> {
  await requireConfigure(tx, input.managementSessionId);
  const patch: { label?: string; color?: string; displayOrder?: number; active?: boolean } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.color !== undefined) patch.color = validateStatusColor(input.color);
  if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;
  if (input.active !== undefined) patch.active = input.active;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(tableServiceStatuses)
      .set(patch)
      .where(eq(tableServiceStatuses.id, input.id))
      .returning({ id: tableServiceStatuses.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `label` participates in the unique, so it was necessarily supplied when this fires.
      throw new AppError("status.label_taken", { label: input.label! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("status.not_found", { statusId: input.id });
  }
}

/** Deactivate a status (`active = false`) — never a hard delete (a table may reference it; app_user
 *  holds no DELETE on `table_service_statuses`). Manager/admin only. Absent id → `status.not_found`. */
export async function deactivateStatus(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; id: string },
): Promise<void> {
  await requireConfigure(tx, input.managementSessionId);
  const updated = await tx
    .update(tableServiceStatuses)
    .set({ active: false })
    .where(eq(tableServiceStatuses.id, input.id))
    .returning({ id: tableServiceStatuses.id });
  if (updated.length === 0) {
    throw new AppError("status.not_found", { statusId: input.id });
  }
}

/**
 * Set (or clear, with `null`) a table's single manual status (design §3b) — an OPERATIONAL verb a
 * logged-in operator uses the way they ring a sale, so it is gated by the operator SESSION at the route
 * (`requireSession`, Task 8), NOT by `till.configure`. Validates the table is active (an absent,
 * deactivated, or foreign/RLS-hidden table → `table.not_found`, design §3b) and, when `statusId` is
 * non-null, that the status is real (`status.not_found`) and `active` (`status.inactive`). Runs on the
 * CALLER's transaction under its tenant/app_user scope. The status is occupancy-INDEPENDENT: a `free`
 * table may carry one, so this never consults the tab state.
 */
export async function setTableStatus(
  tx: Transaction,
  // Unused here for the same reason as `updateTable`/`deactivateTable` — this by-id verb relies on RLS
  // for the tenant scope, so the config is kept only for the uniform `(tx, cfg, …)` verb surface.
  _cfg: TillConfig,
  tableId: string,
  statusId: string | null,
): Promise<void> {
  // Both existence/active reads are independent, so fold them into ONE round trip via two scalar
  // subqueries (2 round trips total instead of 3). Each subquery returns the row's `active` flag, or
  // NULL when no row matches — so a missing row (NULL) stays distinguishable from an inactive one
  // (false), preserving the three domain errors byte-for-byte: table NULL-or-false → `table.not_found`;
  // status NULL → `status.not_found`; status false → `status.inactive`. The status subquery is added
  // only when `statusId` is set — a CLEAR (null) skips the status check entirely, as before.
  const { rows } = await tx.execute<{
    table_active: boolean | null;
    status_active: boolean | null;
  }>(
    statusId === null
      ? sql`select (select ${diningTables.active} from ${diningTables} where ${diningTables.id} = ${tableId}) as table_active`
      : sql`select (select ${diningTables.active} from ${diningTables} where ${diningTables.id} = ${tableId}) as table_active, (select ${tableServiceStatuses.active} from ${tableServiceStatuses} where ${tableServiceStatuses.id} = ${statusId}) as status_active`,
  );
  const row = rows[0]!;
  if (!row.table_active) {
    throw new AppError("table.not_found", { tableId });
  }

  if (statusId !== null) {
    if (row.status_active === null) {
      throw new AppError("status.not_found", { statusId });
    }
    if (!row.status_active) {
      throw new AppError("status.inactive", { statusId });
    }
  }

  await tx.update(diningTables).set({ statusId }).where(eq(diningTables.id, tableId));
}
