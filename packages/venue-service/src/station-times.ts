import { and, asc, desc, eq, ne } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { readLocationClock, venueMomentAt, type VenueMoment } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import { stationDayStates, stationFallbacks } from "./schema/station-times.js";
import { routingModel, scheduledStationStatus } from "./routing-store.js";
import "./errors.js";

export async function venueMoment(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<VenueMoment | null> {
  return venueMomentAt(at, await readLocationClock(tx, cfg.locationId));
}

async function requireStation(tx: Transaction, cfg: VenueScope, stationId: string) {
  const [station] = await tx
    .select({
      id: kitchenStations.id,
      active: kitchenStations.active,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.locationId, cfg.locationId)));
  if (station === undefined) throw new AppError("station.not_found", { stationId });
  return station;
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
  sendsToStationId?: string | null,
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
  const destination = state === "closed" ? (sendsToStationId ?? null) : null;
  await tx
    .insert(stationDayStates)
    .values({
      stationId,
      businessDay: moment.businessDay,
      open: state === "open",
      sendsToStationId: destination,
    })
    .onConflictDoUpdate({
      target: [stationDayStates.stationId, stationDayStates.businessDay],
      set: { open: state === "open", sendsToStationId: destination },
    });
}

export async function stationDestinations(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  at: Date,
): Promise<readonly { id: string; name: string; isDefault: boolean }[]> {
  await requireStation(tx, cfg, stationId);
  const stations = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
        ne(kitchenStations.id, stationId),
      ),
    )
    .orderBy(
      desc(kitchenStations.isDefault),
      asc(kitchenStations.displayOrder),
      asc(kitchenStations.name),
      asc(kitchenStations.id),
    );
  const model = await routingModel(tx, cfg, at);
  const open = new Set(
    model.stationTimes.filter((row) => row.status.open).map((row) => row.stationId),
  );
  return stations.filter((station) => open.has(station.id));
}

export async function closeStationForToday(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  sendsToStationId: string,
  at: Date,
): Promise<void> {
  const station = await requireStation(tx, cfg, stationId);
  if (!station.active) throw new AppError("route.station_inactive", { stationId });
  if (station.isDefault) throw new AppError("station.always_open", { stationId });
  if (sendsToStationId === stationId)
    throw new AppError("station.destination_invalid", {
      stationId,
      sendsToStationId,
      reason: "self",
    });
  const [destination] = await tx
    .select({ active: kitchenStations.active })
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.id, sendsToStationId), eq(kitchenStations.locationId, cfg.locationId)),
    );
  if (destination === undefined)
    throw new AppError("station.destination_invalid", {
      stationId,
      sendsToStationId,
      reason: "unknown",
    });
  if (!destination.active)
    throw new AppError("station.destination_invalid", {
      stationId,
      sendsToStationId,
      reason: "inactive",
    });
  if (
    !(await stationDestinations(tx, cfg, stationId, at)).some((row) => row.id === sendsToStationId)
  )
    throw new AppError("station.destination_invalid", {
      stationId,
      sendsToStationId,
      reason: "closed",
    });
  await setStationToday(tx, cfg, stationId, "closed", at, sendsToStationId);
}

export async function openStationForToday(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
  at: Date,
): Promise<void> {
  const station = await requireStation(tx, cfg, stationId);
  if (!station.active) throw new AppError("route.station_inactive", { stationId });
  const scheduled = await scheduledStationStatus(tx, cfg, stationId, at);
  await setStationToday(tx, cfg, stationId, scheduled.open ? null : "open", at);
}
