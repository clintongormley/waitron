// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { deactivateServiceZone, departments, zoneServicePolicies } from "@waitron/venue-service";
import { authorizeManager } from "@waitron/identity";
import {
  diningTables,
  floorTableShape,
  floorZones,
  isStatusColor,
  isUniqueViolation,
  newId,
  refusalOn,
  UNIQUE_VIOLATION,
  tableServiceStatuses,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";

export type FloorTableShape = (typeof floorTableShape.enumValues)[number];

const COORD_MAX = 1000;
const ROTATION_MAX = 359;

/** Names the FIELD, never the value. */
function requirePlacementInt(value: number, max: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new AppError("placement.invalid", { field });
  }
}

/**
 * Asked BEFORE the write because the engine's foreign-key refusal names no constraint
 * (`packages/db/src/constraint-target.ts`), and `dining_tables` has other foreign keys beside the
 * zone one.
 * `dining_tables_zone_fk` still enforces the reference; this only decides what the caller is told.
 */
async function requireZone(tx: Transaction, zoneId: string): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(eq(floorZones.id, zoneId))
    .limit(1);
  if (zone === undefined) throw new AppError("zone.not_found", { zoneId });
}

async function requireZoneInService(tx: Transaction, tableId: string, zoneId: string) {
  const [row] = await tx
    .select({ zoneActive: floorZones.active, departmentActive: departments.active })
    .from(floorZones)
    .leftJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
    .leftJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(eq(floorZones.id, zoneId));
  if (!row!.zoneActive || row!.departmentActive !== true) {
    throw new AppError("table.zone_inactive", { tableId, zoneId });
  }
}

/** `createdAt` is an ISO string. */
export interface DiningTable {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
  /** Placement is `null` for an unplaced table; rotation is in degrees. */
  posX: number | null;
  posY: number | null;
  shape: FloorTableShape | null;
  rotation: number | null;
}

/**
 * A duplicate `(location, label)` is `table.label_taken`: `dining_tables_location_label_key` is the
 * only unique an insert with a fresh `id` can trip.
 */
export async function createTable(
  tx: Transaction,
  cfg: TillConfig,
  input: { label: string; zoneId?: string; capacity?: number },
): Promise<{ id: string }> {
  const id = newId();
  if (input.zoneId !== undefined) {
    await requireZone(tx, input.zoneId);
    await requireZoneInService(tx, id, input.zoneId);
  }
  try {
    const [row] = await tx
      .insert(diningTables)
      .values({
        id,
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
    throw error;
  }
}

export async function listTables(
  tx: Transaction,
  cfg: TillConfig,
  options: { includeDisabled?: boolean } = {},
): Promise<DiningTable[]> {
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
    .where(
      and(
        eq(diningTables.locationId, cfg.locationId),
        options.includeDisabled ? undefined : eq(diningTables.active, true),
      ),
    )
    .orderBy(diningTables.label);
}

export async function updateTable(
  tx: Transaction,
  // Unused; kept for the uniform `(tx, cfg, …)` verb surface.
  _cfg: TillConfig,
  id: string,
  input: { label?: string; zoneId?: string; capacity?: number; active?: boolean },
): Promise<void> {
  const patch: {
    label?: string;
    zoneId?: string | null;
    capacity?: number | null;
    active?: boolean;
  } = {};
  if (input.label !== undefined || input.zoneId !== undefined || input.active !== undefined) {
    await refuseFloorPlanChange(tx, id, input);
  }
  if (input.label !== undefined) patch.label = input.label;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.active !== undefined) patch.active = input.active;
  if (input.zoneId !== undefined) {
    patch.zoneId = input.zoneId;
    await requireZone(tx, input.zoneId);
  }
  if (input.active === true || (input.zoneId !== undefined && input.active !== false)) {
    const [table] = await tx
      .select({ zoneId: diningTables.zoneId, active: diningTables.active })
      .from(diningTables)
      .where(eq(diningTables.id, id));
    const zoneId = input.zoneId ?? table?.zoneId ?? null;
    if (table !== undefined && (input.active ?? table.active) && zoneId !== null) {
      await requireZoneInService(tx, id, zoneId);
    }
  }

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
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("table.not_found", { tableId: id });
  }
}

/**
 * A planned table's name, zone and on/off state belong to its zone's floor plan: a reset would
 * revert a change made here. Compared by value, because the old floor screen resends the
 * unchanged name with every capacity edit and the current zone with every placement.
 */
async function refuseFloorPlanChange(
  tx: Transaction,
  id: string,
  input: { label?: string; zoneId?: string; active?: boolean },
): Promise<void> {
  const [table] = await tx
    .select({
      label: diningTables.label,
      zoneId: diningTables.zoneId,
      active: diningTables.active,
      planned: diningTables.planned,
    })
    .from(diningTables)
    .where(eq(diningTables.id, id));
  if (table === undefined || !table.planned) return;
  if (
    (input.label !== undefined && input.label !== table.label) ||
    (input.zoneId !== undefined && input.zoneId !== table.zoneId) ||
    (input.active !== undefined && input.active !== table.active)
  ) {
    throw new AppError("table.in_floor_plan", { tableId: id });
  }
}

/** Deactivate, never hard-delete, because the table has order history. */
export async function deactivateTable(
  tx: Transaction,
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  await refuseFloorPlanChange(tx, id, { active: false });
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
 * Both the table and the zone must be active and in `cfg.locationId`. The zone is checked by an
 * explicit read because `dining_tables_zone_fk` sees neither `active` nor the location.
 */
export async function setTablePlacement(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  p: { zoneId: string; posX: number; posY: number; shape: FloorTableShape; rotation: number },
): Promise<void> {
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

  await refuseFloorPlanChange(tx, tableId, { zoneId: p.zoneId });
  await requireZoneInService(tx, tableId, p.zoneId);

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

/** Leaves `zone_id`: a table may belong to a zone without being placed on the canvas. */
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

export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

export async function listZones(
  tx: Transaction,
  cfg: TillConfig,
  options: { includeInactive?: boolean } = {},
): Promise<FloorZone[]> {
  return tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      displayOrder: floorZones.displayOrder,
      active: floorZones.active,
    })
    .from(floorZones)
    .where(
      options.includeInactive
        ? eq(floorZones.locationId, cfg.locationId)
        : and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)),
    )
    .orderBy(floorZones.displayOrder);
}

export async function updateZone(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  patch: { name?: string; displayOrder?: number; active?: boolean },
): Promise<void> {
  const set: { name?: string; displayOrder?: number; active?: boolean } = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;
  if (patch.active !== undefined) set.active = patch.active;

  if (patch.active === true) {
    const [zone] = await tx
      .select({ departmentActive: departments.active })
      .from(floorZones)
      .leftJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
      .leftJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
      .where(and(eq(floorZones.id, id), eq(floorZones.locationId, cfg.locationId)));
    if (zone === undefined) throw new AppError("zone.not_found", { zoneId: id });
    if (zone.departmentActive !== true) {
      throw new AppError("zone.department_inactive", { zoneId: id });
    }
  }

  if (patch.active === false) {
    const [zone] = await tx
      .select({ id: floorZones.id })
      .from(floorZones)
      .where(and(eq(floorZones.id, id), eq(floorZones.locationId, cfg.locationId)));
    if (zone === undefined) throw new AppError("zone.not_found", { zoneId: id });
    await deactivateServiceZone(tx, cfg, id);
  }

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(floorZones)
      .set(set)
      .where(eq(floorZones.id, id))
      .returning({ id: floorZones.id });
  } catch (error) {
    if (
      patch.name !== undefined &&
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_zones",
        columns: ["location_id", "name"],
      })
    ) {
      const [other] = await tx
        .select({ id: floorZones.id, active: floorZones.active })
        .from(floorZones)
        .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.name, patch.name)));
      if (other?.active === false)
        throw new AppError("zone.name_disabled", { name: patch.name, zoneId: other.id });
      throw new AppError("zone.name_taken", { name: patch.name });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("zone.not_found", { zoneId: id });
  }
}

/** Never a hard delete: a `dining_tables.zone_id` may reference it. */
export async function deactivateZone(tx: Transaction, cfg: TillConfig, id: string): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(and(eq(floorZones.id, id), eq(floorZones.locationId, cfg.locationId)));
  if (zone === undefined) throw new AppError("zone.not_found", { zoneId: id });
  await deactivateServiceZone(tx, cfg, id);
}

/** `createdAt` is an ISO string. */
export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

function validateStatusColor(color: string): string {
  if (!isStatusColor(color)) {
    throw new AppError("management.request_invalid", { field: "color" });
  }
  return color;
}

async function requireConfigure(tx: Transaction, managementSessionId: string): Promise<void> {
  await authorizeManager(tx, { managementSessionId, permission: "venue.configure" });
}

export async function createStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
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

export interface ServiceStatusOption {
  id: string;
  label: string;
  color: string;
}

/**
 * Active statuses only, because `setTableStatus` refuses an inactive one. Gated by the till
 * session at the route, not `venue.configure`: an operator holds no management session.
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

/** Inactive statuses included, so the editor can reactivate one. */
export async function listStatuses(
  tx: Transaction,
  input: { managementSessionId: string },
): Promise<ServiceStatus[]> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "venue.view",
  });
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

export async function updateStatus(
  tx: Transaction,
  input: {
    managementSessionId: string;
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

/** Never a hard delete: a table may reference it. */
export async function deactivateStatus(
  tx: Transaction,
  input: { managementSessionId: string; id: string },
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
 * An operational verb, gated by the operator's session at the route rather than `venue.configure`.
 * The status is independent of occupancy: a free table may carry one.
 */
export async function setTableStatus(
  tx: Transaction,
  _cfg: TillConfig,
  tableId: string,
  statusId: string | null,
): Promise<void> {
  // Each subquery is NULL when no row matches, so a missing status stays distinct from an inactive
  // one. `number`, not `boolean`: a raw-SQL read bypasses the `flag` column's boolean mapping.
  const { rows } = await tx.execute<{
    table_active: number | null;
    status_active: number | null;
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
