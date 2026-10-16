import { and, eq } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import type { LocalDate } from "./hours-types.js";
import { addDays, isLocalDate } from "./hours-rules.js";
import type { ServiceRange } from "./service-day.js";
import { readPlannedServiceGuides } from "./planned-service-guides.js";
import "./errors.js";

export interface StationServiceDay {
  readonly date: LocalDate;
  readonly departments: readonly { departmentId: string; ranges: readonly ServiceRange[] }[];
}
export interface StationServiceTimes {
  readonly always: "default" | null;
  readonly days: readonly StationServiceDay[];
}

export async function stationServiceTimes(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  from: LocalDate,
  to: LocalDate,
): Promise<StationServiceTimes> {
  if (!isLocalDate(from)) throw new AppError("management.request_invalid", { field: "from" });
  if (!isLocalDate(to) || to < from)
    throw new AppError("management.request_invalid", { field: "to" });
  const dayCount =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (dayCount > 42) throw new AppError("management.request_invalid", { field: "to" });
  const [station] = await tx
    .select({ active: kitchenStations.active, isDefault: kitchenStations.isDefault })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, stationId),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (!station) throw new AppError("station.not_found", { stationId });
  if (station.isDefault) return { always: "default", days: [] };

  const clock = await readLocationClock(tx, cfg.locationId);
  const dates = Array.from({ length: dayCount }, (_, index) => addDays(from, index));
  const guides = await readPlannedServiceGuides(tx, cfg, [stationId], {
    kind: "dates",
    dates,
    clock,
  });
  return {
    always: null,
    days: dates.map((date) => ({
      date,
      departments: guides.stationRanges.get(stationId)!.get(date)!,
    })),
  };
}
