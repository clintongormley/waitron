import "./errors.js";
import { eq } from "drizzle-orm";
import { kitchenStations, kitchenStationTiming, kitchenTimingDefaults } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { StationThresholds } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;

export type StationTimingPatch = Partial<{
  [Field in keyof StationThresholds]: number | null;
}>;

export function parseStationTimingPatch(body: Record<string, unknown>): StationTimingPatch {
  const patch: StationTimingPatch = {};
  for (const field of fields) {
    const value = body[field];
    if (value === undefined) continue;
    if (
      value !== null &&
      (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647)
    ) {
      throw new AppError("management.request_invalid", { field });
    }
    patch[field] = value;
  }
  return patch;
}

export function assertStationTiming(
  overrides: StationTimingPatch,
  defaults: StationThresholds,
  station: { id?: string; name: string },
): void {
  const field = invalidTimingField({
    warmAfterMinutes: overrides.warmAfterMinutes ?? defaults.warmAfterMinutes,
    overdueAfterMinutes: overrides.overdueAfterMinutes ?? defaults.overdueAfterMinutes,
    forgottenAfterMinutes: overrides.forgottenAfterMinutes ?? defaults.forgottenAfterMinutes,
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

export async function getKitchenTimingDefaults(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
): Promise<StationThresholds> {
  const [defaults] = await tx
    .select({
      warmAfterMinutes: kitchenTimingDefaults.warmAfterMinutes,
      overdueAfterMinutes: kitchenTimingDefaults.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenTimingDefaults.forgottenAfterMinutes,
    })
    .from(kitchenTimingDefaults)
    .where(eq(kitchenTimingDefaults.locationId, cfg.locationId));
  if (defaults === undefined) throw new Error("Venue has no kitchen timing defaults");
  return defaults;
}

export async function assertKitchenTimingStations(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
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
    .orderBy(kitchenStations.displayOrder, kitchenStations.name);
  // Disabled stations retain work and can be enabled again, so their overrides must remain valid.
  for (const station of stations) {
    assertStationTiming(station, defaults, station);
  }
}

export async function setKitchenTimingDefaults(
  tx: Transaction,
  cfg: TillConfig,
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
