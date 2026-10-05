import "./errors.js";
import { eq } from "drizzle-orm";
import { kitchenStations, kitchenStationTiming, kitchenTimingDefaults } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { StationThresholds } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;

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
  if (timing.overdueAfterMinutes <= timing.warmAfterMinutes) return "overdueAfterMinutes";
  if (timing.forgottenAfterMinutes <= timing.overdueAfterMinutes) return "forgottenAfterMinutes";
  return undefined;
}

export async function getKitchenTimingDefaults(
  tx: Transaction,
  cfg: TillConfig,
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

export async function setKitchenTimingDefaults(
  tx: Transaction,
  cfg: TillConfig,
  input: unknown,
): Promise<void> {
  const defaults = parseKitchenTimingDefaults(input);
  await getKitchenTimingDefaults(tx, cfg);
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
    const field = invalidTimingField({
      warmAfterMinutes: station.warmAfterMinutes ?? defaults.warmAfterMinutes,
      overdueAfterMinutes: station.overdueAfterMinutes ?? defaults.overdueAfterMinutes,
      forgottenAfterMinutes: station.forgottenAfterMinutes ?? defaults.forgottenAfterMinutes,
    });
    if (field !== undefined) {
      throw new AppError("station.thresholds_invalid", {
        field,
        stationId: station.id,
        name: station.name,
      });
    }
  }
  await tx
    .update(kitchenTimingDefaults)
    .set(defaults)
    .where(eq(kitchenTimingDefaults.locationId, cfg.locationId));
}
