// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { and, eq, not, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  savedPart,
  tableInService,
  diningTables,
  floorZones,
  refusalOn,
  UNIQUE_VIOLATION,
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
