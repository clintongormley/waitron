import { type Transaction, kitchenStations } from "@waitron/db";
import type { ResolvedKitchenScreen, KitchenScreenKind, ScreenSlot } from "@waitron/module";
import { AppError, compareStationNames } from "@waitron/shared";
import { eq, asc } from "drizzle-orm";
import type { Context } from "hono";
import type { DeviceBinding } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import type { PassBoard } from "./pass-card.js";
import { signedInPersonOn } from "./till-session.js";
import {
  type StationQueueGroup,
  listStationQueues,
  stationHasWork,
} from "./working-order-station-queue.js";
import "./errors.js";

export async function stationScreenOf(
  tx: Transaction,
  c: Context,
  device: DeviceBinding,
): Promise<ResolvedKitchenScreen> {
  return (await kitchenScreenOf(tx, c, device, "station")).screen;
}
/** A pass board's answer: the board, the screen's stations and zones, and its display choice. */
export function passBoardAnswer(board: PassBoard, screen: ResolvedKitchenScreen) {
  return {
    board,
    stations: screen.stations,
    zones: screen.zones,
    display: {
      showNonPassStations: screen.showNonPassStations,
    },
  };
}
export async function kitchenScreenOf(
  tx: Transaction,
  c: Context,
  device: DeviceBinding,
  kind: KitchenScreenKind,
): Promise<{ screen: ResolvedKitchenScreen; personId: string | null }> {
  const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, device.deviceId)).find(
    (candidate) => candidate.kind === kind,
  );
  if (screen?.available !== true) throw new AppError("device.unauthorized", {});
  const signedIn = await signedInPersonOn(tx, c, device.deviceId);
  if (device.formFactor === "kds")
    return { screen, personId: signedIn.outcome === "person" ? signedIn.personId : null };
  if (signedIn.outcome === "refused") throw signedIn.refusal;
  if (signedIn.outcome === "nobody") throw new AppError("session.required", {});
  return { screen, personId: signedIn.personId };
}
export async function stationScreenSlots(
  tx: Transaction,
  screen: ResolvedKitchenScreen,
): Promise<{ slots: ScreenSlot[]; queues: Map<string, StationQueueGroup[]> }> {
  const worked = (slot: ScreenSlot) => slot.available || slot.switchedOff;
  if (!screen.everyStation) {
    const queues = await listStationQueues(
      tx,
      screen.stations.filter(worked).map((slot) => slot.id),
    );
    return { slots: [...screen.stations], queues };
  }
  const listed = new Map(screen.stations.map((slot) => [slot.id, slot]));
  const everyStation = await stationsHere(tx);
  const off = everyStation.filter((station) => !station.active && !listed.has(station.id));
  const queues = await listStationQueues(tx, [
    ...screen.stations.filter(worked).map((slot) => slot.id),
    ...off.map((station) => station.id),
  ]);
  for (const station of off) if (queues.get(station.id)!.length === 0) queues.delete(station.id);
  const slots = everyStation.flatMap(({ id, name }): ScreenSlot[] => {
    const slot = listed.get(id);
    if (slot !== undefined) return [slot];
    return queues.has(id) ? [{ id, name, available: false, switchedOff: true }] : [];
  });
  return { slots, queues };
}
/** Whether the station screen may start, ready and acknowledge work at `stationId`: as
 *  {@link stationScreenSlots} lists it with a queue. */
export async function worksStation(
  tx: Transaction,
  screen: ResolvedKitchenScreen,
  stationId: string,
): Promise<boolean> {
  const slot = screen.stations.find((candidate) => candidate.id === stationId);
  if (slot !== undefined) return slot.available || slot.switchedOff;
  if (!screen.everyStation) return false;
  const [station] = await tx
    .select({ active: kitchenStations.active })
    .from(kitchenStations)
    .where(eq(kitchenStations.id, stationId));
  if (station === undefined || station.active) return false;
  return stationHasWork(tx, stationId);
}
/** The venue's stations, historical rows included. */
async function stationsHere(tx: Transaction) {
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name, active: kitchenStations.active })
    .from(kitchenStations)
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  return stations.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
}
