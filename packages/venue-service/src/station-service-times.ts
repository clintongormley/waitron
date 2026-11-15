import { and, eq } from "drizzle-orm";
import { kitchenStations, readVenueClock, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
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
  readonly days: readonly StationServiceDay[];
}

export type StationsServiceTimes = Readonly<Record<string, StationServiceTimes>>;

function serviceDates(from: LocalDate, to: LocalDate): LocalDate[] {
  if (!isLocalDate(from)) throw new AppError("management.request_invalid", { field: "from" });
  if (!isLocalDate(to) || to < from)
    throw new AppError("management.request_invalid", { field: "to" });
  const dayCount =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (dayCount > 42) throw new AppError("management.request_invalid", { field: "to" });
  return Array.from({ length: dayCount }, (_, index) => addDays(from, index));
}

export async function stationServiceTimes(
  tx: Transaction,
  stationId: string,
  from: LocalDate,
  to: LocalDate,
): Promise<StationServiceTimes> {
  const dates = serviceDates(from, to);
  const [station] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.active, true)));
  if (!station) throw new AppError("station.not_found", { stationId });

  const clock = await readVenueClock(tx);
  const guides = await readPlannedServiceGuides(tx, [stationId], {
    kind: "dates",
    dates,
    clock,
  });
  return {
    days: dates.map((date) => ({
      date,
      departments: guides.stationRanges.get(stationId)!.get(date)!,
    })),
  };
}

export async function stationsServiceTimes(
  tx: Transaction,
  from: LocalDate,
  to: LocalDate,
): Promise<StationsServiceTimes> {
  const dates = serviceDates(from, to);
  const stations = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(eq(kitchenStations.active, true));
  const clock = await readVenueClock(tx);
  const guides = await readPlannedServiceGuides(
    tx,
    stations.map((station) => station.id),
    { kind: "dates", dates, clock },
  );
  return Object.fromEntries(
    stations.map((station) => [
      station.id,
      {
        days: dates.map((date) => ({
          date,
          departments: guides.stationRanges.get(station.id)!.get(date)!,
        })),
      },
    ]),
  );
}
