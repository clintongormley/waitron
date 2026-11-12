import type { ActivityActor } from "@waitron/module";
import { and, asc, eq, ne } from "drizzle-orm";
import { kitchenStations, readVenueClock, recordActivity, type Transaction } from "@waitron/db";
import { venueMomentAt, type VenueMoment } from "@waitron/reporting";
import { AppError, compareStationNames } from "@waitron/shared";
import { routingModel } from "./routing-store.js";
import "./errors.js";

export async function venueMoment(tx: Transaction, at: Date): Promise<VenueMoment | null> {
  return venueMomentAt(at, await readVenueClock(tx));
}

async function requireStation(tx: Transaction, stationId: string) {
  const [station] = await tx
    .select({
      id: kitchenStations.id,
      active: kitchenStations.active,
      isDefault: kitchenStations.isDefault,
      closedOnDay: kitchenStations.closedOnDay,
      closedSendsToStationId: kitchenStations.closedSendsToStationId,
      whenClosedSendsToStationId: kitchenStations.whenClosedSendsToStationId,
    })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.active, true)));
  if (station === undefined) throw new AppError("station.not_found", { stationId });
  return station;
}

export async function setStationToday(
  tx: Transaction,
  stationId: string,
  state: "open" | "closed" | null,
  at: Date,
  actor: ActivityActor,
  sendsToStationId?: string | null,
): Promise<void> {
  const station = await requireStation(tx, stationId);
  const moment = await venueMoment(tx, at);
  if (moment === null) throw new AppError("time_zone.unreadable", {});
  const wasClosed = station.closedOnDay === moment.businessDay;
  const closed = state === "closed";
  const destination = closed ? (sendsToStationId ?? null) : null;
  await tx
    .update(kitchenStations)
    .set({ closedOnDay: closed ? moment.businessDay : null, closedSendsToStationId: destination })
    .where(eq(kitchenStations.id, stationId));
  if (wasClosed !== closed || (closed && station.closedSendsToStationId !== destination))
    await recordActivity(tx, {
      kind: closed ? "station.closed_for_day" : "station.reopened",
      subjectId: stationId,
      personId: actor.personId,
      deviceId: actor.deviceId,
      at,
      data: {
        businessDay: moment.businessDay,
        sendsTo: closed ? destination : station.closedSendsToStationId,
        authorizedBy: actor.authorizedBy,
      },
    });
}

export async function stationDestinations(
  tx: Transaction,
  stationId: string,
  at: Date,
): Promise<readonly { id: string; name: string; isDefault: boolean; preferred: boolean }[]> {
  const { whenClosedSendsToStationId } = await requireStation(tx, stationId);
  const stations = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.active, true), ne(kitchenStations.id, stationId)))
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  const model = await routingModel(tx, at);
  const open = new Set(
    model.stationTimes.filter((row) => row.status.open).map((row) => row.stationId),
  );
  return stations
    .sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id))
    .filter((station) => open.has(station.id))
    .map((station) => ({ ...station, preferred: station.id === whenClosedSendsToStationId }));
}

export async function closeStationForToday(
  tx: Transaction,
  stationId: string,
  sendsToStationId: string,
  at: Date,
  actor: ActivityActor,
): Promise<void> {
  const station = await requireStation(tx, stationId);
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
    .where(eq(kitchenStations.id, sendsToStationId));
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
  if (!(await stationDestinations(tx, stationId, at)).some((row) => row.id === sendsToStationId))
    throw new AppError("station.destination_invalid", {
      stationId,
      sendsToStationId,
      reason: "closed",
    });
  await setStationToday(tx, stationId, "closed", at, actor, sendsToStationId);
}

export async function openStationForToday(
  tx: Transaction,
  stationId: string,
  at: Date,
  actor: ActivityActor,
): Promise<void> {
  await requireStation(tx, stationId);
  await setStationToday(tx, stationId, null, at, actor);
}
