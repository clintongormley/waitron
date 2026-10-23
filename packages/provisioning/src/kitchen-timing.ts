import "./errors.js";
import { eq } from "drizzle-orm";
import { kitchenStations, kitchenStationTiming, kitchenTimingDefaults } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, DEFAULT_STATION_THRESHOLDS, compareStationNames } from "@waitron/shared";
import type { StationThresholds } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";

const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;

export type StationTimingPatch = Partial<StationThresholds>;

export function parseStationTimingPatch(body: Record<string, unknown>): StationTimingPatch {
  const patch: StationTimingPatch = {};
  for (const field of fields) {
    const value = body[field];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 2_147_483_647
    ) {
      throw new AppError("management.request_invalid", { field });
    }
    patch[field] = value;
  }
  return patch;
}

export function assertStationTiming(
  patch: StationTimingPatch,
  base: StationThresholds,
  station: { id?: string; name: string },
): void {
  const field = invalidTimingField({
    warmAfterMinutes: patch.warmAfterMinutes ?? base.warmAfterMinutes,
    overdueAfterMinutes: patch.overdueAfterMinutes ?? base.overdueAfterMinutes,
    forgottenAfterMinutes: patch.forgottenAfterMinutes ?? base.forgottenAfterMinutes,
  });
  if (field !== undefined) {
    throw new AppError("station.thresholds_invalid", {
      field,
      ...(station.id === undefined ? {} : { stationId: station.id }),
      name: station.name,
    });
  }
}

function parseKitchenTimingDefaults(input: unknown): StationThresholds {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppError("management.request_invalid", { field: "body" });
  }
  const body = input as Record<string, unknown>;
  for (const field of fields) {
    const value = body[field];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 2_147_483_647
    ) {
      throw new AppError("management.request_invalid", { field });
    }
  }
  const thresholds: StationThresholds = {
    warmAfterMinutes: body.warmAfterMinutes as number,
    overdueAfterMinutes: body.overdueAfterMinutes as number,
    forgottenAfterMinutes: body.forgottenAfterMinutes as number,
  };
  const field = invalidTimingField(thresholds);
  if (field !== undefined) throw new AppError("management.request_invalid", { field });
  return thresholds;
}

function invalidTimingField(timing: StationThresholds): string | undefined {
  for (const field of fields) {
    const value = timing[field];
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) return field;
  }
  if (timing.overdueAfterMinutes <= timing.warmAfterMinutes) return "overdueAfterMinutes";
  if (timing.forgottenAfterMinutes <= timing.overdueAfterMinutes) return "forgottenAfterMinutes";
  return undefined;
}

const columns = {
  warmAfterMinutes: "warm_after_minutes",
  overdueAfterMinutes: "overdue_after_minutes",
  forgottenAfterMinutes: "forgotten_after_minutes",
} as const;

/** A bundle's station ids are the exporting venue's, so a refusal names the station only. */
export function assertImportedStationTimings(rows: readonly Record<string, unknown>[]): void {
  const stations = rows.map((row) => ({ id: String(row.id), name: String(row.name), row }));
  stations.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
  for (const { name, row } of stations) {
    const timing = {} as Record<(typeof fields)[number], unknown>;
    for (const field of fields) {
      const value = row[columns[field]];
      timing[field] = value === undefined ? DEFAULT_STATION_THRESHOLDS[field] : value;
    }
    const field = invalidTimingField(timing as unknown as StationThresholds);
    if (field !== undefined) throw new AppError("station.thresholds_invalid", { field, name });
  }
}

export async function getKitchenTimingDefaults(
  tx: Transaction,
  cfg: { locationId: LocationId },
): Promise<StationThresholds> {
  const [defaults] = await tx
    .select({
      warmAfterMinutes: kitchenTimingDefaults.warmAfterMinutes,
      overdueAfterMinutes: kitchenTimingDefaults.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenTimingDefaults.forgottenAfterMinutes,
    })
    .from(kitchenTimingDefaults)
    .where(eq(kitchenTimingDefaults.locationId, cfg.locationId));
  if (defaults === undefined)
    throw new AppError("station.timing_missing", { locationId: cfg.locationId });
  return defaults;
}

export async function assertKitchenTimingStations(
  tx: Transaction,
  cfg: { locationId: LocationId },
  defaults: StationThresholds,
): Promise<void> {
  const stations = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      warmAfterMinutes: kitchenStationTiming.warmAfterMinutes,
      overdueAfterMinutes: kitchenStationTiming.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStationTiming.forgottenAfterMinutes,
    })
    .from(kitchenStations)
    .leftJoin(kitchenStationTiming, eq(kitchenStationTiming.stationId, kitchenStations.id))
    .where(eq(kitchenStations.locationId, cfg.locationId))
    .orderBy(kitchenStations.name, kitchenStations.id);
  stations.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
  for (const station of stations) {
    const patch: StationTimingPatch = {};
    for (const field of fields) {
      const value = station[field];
      if (value !== null) patch[field] = value;
    }
    assertStationTiming(patch, defaults, station);
  }
}

export async function setKitchenTimingDefaults(
  tx: Transaction,
  cfg: { locationId: LocationId },
  input: unknown,
): Promise<void> {
  const defaults = parseKitchenTimingDefaults(input);
  await getKitchenTimingDefaults(tx, cfg);
  await assertKitchenTimingStations(tx, cfg, defaults);
  await tx
    .update(kitchenTimingDefaults)
    .set(defaults)
    .where(eq(kitchenTimingDefaults.locationId, cfg.locationId));
}
