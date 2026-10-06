import { and, eq, ne } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { readLocationClock, venueMomentAt, type VenueMoment } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import { stationDayStates, stationFallbacks } from "./schema/station-times.js";
import "./errors.js";

export async function venueMoment(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<VenueMoment | null> {
  return venueMomentAt(at, await readLocationClock(tx, cfg.locationId));
}

async function requireStation(tx: Transaction, cfg: VenueScope, stationId: string): Promise<void> {
  const [station] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.locationId, cfg.locationId)));
  if (station === undefined) throw new AppError("station.not_found", { stationId });
}

export async function setStationFallback(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  fallbackStationId: string | null,
): Promise<void> {
  await requireStation(tx, cfg, stationId);
  if (fallbackStationId === null) {
    await tx.delete(stationFallbacks).where(eq(stationFallbacks.stationId, stationId));
    return;
  }
  const [fallback] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, fallbackStationId),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (fallback === undefined)
    throw new AppError("route.station_inactive", { stationId: fallbackStationId });
  const seen = new Set<string>();
  let current: string | null = fallbackStationId;
  while (current !== null && !seen.has(current)) {
    if (current === stationId)
      throw new AppError("station.fallback_loop", { stationId, fallbackStationId });
    seen.add(current);
    const [row]: { fallbackStationId: string }[] = await tx
      .select({ fallbackStationId: stationFallbacks.fallbackStationId })
      .from(stationFallbacks)
      .where(eq(stationFallbacks.stationId, current));
    current = row?.fallbackStationId ?? null;
  }
  await tx
    .insert(stationFallbacks)
    .values({ stationId, fallbackStationId })
    .onConflictDoUpdate({ target: stationFallbacks.stationId, set: { fallbackStationId } });
}

export async function setStationToday(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  state: "open" | "closed" | null,
  at: Date,
): Promise<void> {
  await requireStation(tx, cfg, stationId);
  const moment = await venueMoment(tx, cfg, at);
  if (moment === null) throw new AppError("time_zone.unreadable", {});
  await tx
    .delete(stationDayStates)
    .where(
      and(
        eq(stationDayStates.stationId, stationId),
        ne(stationDayStates.businessDay, moment.businessDay),
      ),
    );
  if (state === null) {
    await tx
      .delete(stationDayStates)
      .where(
        and(
          eq(stationDayStates.stationId, stationId),
          eq(stationDayStates.businessDay, moment.businessDay),
        ),
      );
    return;
  }
  await tx
    .insert(stationDayStates)
    .values({ stationId, businessDay: moment.businessDay, open: state === "open" })
    .onConflictDoUpdate({
      target: [stationDayStates.stationId, stationDayStates.businessDay],
      set: { open: state === "open" },
    });
}
