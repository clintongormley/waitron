// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { and, eq, not, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { authorizeManager } from "@waitron/identity";
import {
  savedPart,
  tableInService,
  diningTables,
  floorZones,
  isStatusColor,
  isUniqueViolation,
  refusalOn,
  UNIQUE_VIOLATION,
  tableServiceStatuses,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { todayBusinessDay } from "./floor-today-store.js";
import type { TillConfig } from "./till-config.js";

/** `createdAt` is an ISO string. */
export interface DiningTable {
  id: string;
  label: string;
  zoneId: string;
  planTableId: string | null;
  createdAt: string;
}

export async function listTables(
  tx: Transaction,
  cfg: TillConfig,
  now: Date,
  options: { includeDisabled?: boolean } = {},
): Promise<DiningTable[]> {
  const businessDay = options.includeDisabled ? null : await todayBusinessDay(tx, cfg, now);
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zoneId: sql<string>`${diningTables.zoneId}`,
      planTableId: diningTables.planTableId,
      createdAt: diningTables.createdAt,
    })
    .from(diningTables)
    .innerJoin(floorZones, eq(floorZones.id, diningTables.zoneId))
    .where(
      and(
        eq(diningTables.locationId, cfg.locationId),
        eq(floorZones.active, true),
        options.includeDisabled
          ? undefined
          : and(tableInService(diningTables.id), not(savedPart(diningTables.id, businessDay))),
      ),
    )
    .orderBy(diningTables.label);
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
  _options: { includeInactive?: boolean } = {},
): Promise<FloorZone[]> {
  void _options;
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

export async function updateZone(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  patch: { name?: string; displayOrder?: number },
): Promise<void> {
  const [target] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(
      and(
        eq(floorZones.id, id),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (target === undefined) throw new AppError("zone.not_found", { zoneId: id });
  const set: { name?: string; displayOrder?: number } = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;

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
      throw new AppError("zone.name_taken", { name: patch.name });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("zone.not_found", { zoneId: id });
  }
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
    table_in_service: number | null;
    status_active: number | null;
  }>(
    statusId === null
      ? sql`select (select ${tableInService(diningTables.id)} from ${diningTables} where ${diningTables.id} = ${tableId}) as table_in_service`
      : sql`select (select ${tableInService(diningTables.id)} from ${diningTables} where ${diningTables.id} = ${tableId}) as table_in_service, (select ${tableServiceStatuses.active} from ${tableServiceStatuses} where ${tableServiceStatuses.id} = ${statusId}) as status_active`,
  );
  const row = rows[0]!;
  if (!row.table_in_service) {
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
