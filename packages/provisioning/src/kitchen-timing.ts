import "./errors.js";
import { AppError, DEFAULT_STATION_THRESHOLDS, compareStationNames } from "@waitron/shared";
import type { StationThresholds } from "@waitron/shared";

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

function invalidTimingField(
  timing: Readonly<Record<(typeof fields)[number], unknown>>,
): string | undefined {
  const minutes = {} as StationThresholds;
  for (const field of fields) {
    const value = timing[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647)
      return field;
    minutes[field] = value;
  }
  if (minutes.overdueAfterMinutes <= minutes.warmAfterMinutes) return "overdueAfterMinutes";
  if (minutes.forgottenAfterMinutes <= minutes.overdueAfterMinutes) return "forgottenAfterMinutes";
  return undefined;
}

const columns = {
  warmAfterMinutes: "warm_after_minutes",
  overdueAfterMinutes: "overdue_after_minutes",
  forgottenAfterMinutes: "forgotten_after_minutes",
} as const;

/** A bundle's station ids are the exporting venue's, so a refusal names the station only. */
export function assertImportedStationTimings(rows: readonly Record<string, unknown>[]): void {
  const stations = rows.map((row) => ({
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    row,
  }));
  stations.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
  for (const { name, row } of stations) {
    const timing = {} as Record<(typeof fields)[number], unknown>;
    for (const field of fields) {
      const value = row[columns[field]];
      timing[field] = value === undefined ? DEFAULT_STATION_THRESHOLDS[field] : value;
    }
    const field = invalidTimingField(timing);
    if (field !== undefined) throw new AppError("station.thresholds_invalid", { field, name });
  }
}
