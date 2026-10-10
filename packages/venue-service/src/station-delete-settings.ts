import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { deviceProfiles, devices, kitchenStations, type Transaction } from "@waitron/db";
import {
  AppError,
  createLabelComparator,
  type DeleteImpactItem,
  type DeleteTarget,
} from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import { readDevicesKitchenScreens } from "./kitchen-screens.js";
import { routingCells, routingCellPeriods } from "./schema/routing.js";
import { stationDayStates } from "./schema/station-times.js";
import {
  deviceKitchenScreenStations,
  deviceKitchenScreenRemovals,
  deviceProfileKitchenScreenStations,
} from "./schema/kitchen-screens.js";
import "./errors.js";

export type StationDeleteSettings = { removes: DeleteImpactItem[]; boundScreens: DeleteTarget[] };

async function settings(tx: Transaction, cfg: VenueScope, id: string) {
  const [station] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, id),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (station === undefined) throw new AppError("station.not_found", { stationId: id });
  const cells = await tx
    .select({ id: routingCells.id })
    .from(routingCells)
    .where(and(eq(routingCells.locationId, cfg.locationId), eq(routingCells.stationId, id)));
  const periods = await tx
    .select({ id: routingCellPeriods.id })
    .from(routingCellPeriods)
    .innerJoin(routingCells, eq(routingCells.id, routingCellPeriods.cellId))
    .where(
      and(
        eq(routingCells.locationId, cfg.locationId),
        or(
          eq(routingCellPeriods.stationId, id),
          inArray(
            routingCellPeriods.cellId,
            cells.map((row) => row.id),
          ),
        ),
      ),
    );
  const memberships = await tx
    .select({ id: devices.id, name: devices.label })
    .from(deviceKitchenScreenStations)
    .innerJoin(devices, eq(devices.id, deviceKitchenScreenStations.deviceId))
    .where(eq(deviceKitchenScreenStations.stationId, id));
  const notices = await tx
    .select({ id: deviceKitchenScreenRemovals.id, deviceId: devices.id, name: devices.label })
    .from(deviceKitchenScreenRemovals)
    .innerJoin(devices, eq(devices.id, deviceKitchenScreenRemovals.deviceId))
    .where(eq(deviceKitchenScreenRemovals.stationId, id));
  const profiles = await tx
    .select({ id: deviceProfiles.id, name: deviceProfiles.name })
    .from(deviceProfileKitchenScreenStations)
    .innerJoin(
      deviceProfiles,
      eq(deviceProfiles.id, deviceProfileKitchenScreenStations.deviceProfileId),
    )
    .where(eq(deviceProfileKitchenScreenStations.stationId, id));
  const daily = await tx
    .select({ id: stationDayStates.id })
    .from(stationDayStates)
    .where(eq(stationDayStates.stationId, id));
  const incoming = await tx
    .select({ rowId: stationDayStates.id, id: kitchenStations.id, name: kitchenStations.name })
    .from(stationDayStates)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationDayStates.stationId))
    .where(eq(stationDayStates.sendsToStationId, id));
  const displays = await tx
    .select({ id: devices.id, name: devices.label })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(
      and(
        eq(devices.locationId, cfg.locationId),
        isNull(devices.deletedAt),
        eq(deviceProfiles.formFactor, "kds"),
      ),
    );
  const bound: DeleteTarget[] = [];
  const resolved = await readDevicesKitchenScreens(
    tx,
    cfg,
    displays.map((display) => display.id),
  );
  for (const display of displays) {
    const screens = resolved.get(display.id)!;
    if (
      screens.some(
        (screen) =>
          screen.available &&
          !(screen.everyStation && screen.profileEveryStation) &&
          screen.stations.some((slot) => slot.id === id && slot.available),
      )
    )
      bound.push(display);
  }
  const compare = createLabelComparator();
  const targets = (rows: DeleteTarget[]) =>
    [...new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }])).values()].sort(
      (a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id),
    );
  const deviceTargets = targets([
    ...memberships,
    ...notices.map((row) => ({ id: row.deviceId, name: row.name })),
  ]);
  const profileTargets = targets(profiles);
  const destinationTargets = targets(incoming);
  const removes: DeleteImpactItem[] = [
    { key: "station_routing_cells", count: cells.length, targets: [] },
    { key: "station_routing_periods", count: periods.length, targets: [] },
    { key: "station_device_screens", count: deviceTargets.length, targets: deviceTargets },
    { key: "station_profile_screens", count: profileTargets.length, targets: profileTargets },
    { key: "station_daily_states", count: daily.length, targets: [] },
    {
      key: "station_daily_destinations",
      count: destinationTargets.length,
      targets: destinationTargets,
    },
  ].filter((item) => item.count > 0);
  return { cells, periods, daily, incoming, impact: { removes, boundScreens: targets(bound) } };
}

export async function readStationDeleteSettings(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<StationDeleteSettings> {
  return (await settings(tx, cfg, id)).impact;
}

export async function clearStationDeleteSettings(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<void> {
  const rows = await settings(tx, cfg, id);
  if (rows.periods.length > 0)
    await tx.delete(routingCellPeriods).where(
      inArray(
        routingCellPeriods.id,
        rows.periods.map((row) => row.id),
      ),
    );
  if (rows.cells.length > 0)
    await tx.delete(routingCells).where(
      inArray(
        routingCells.id,
        rows.cells.map((row) => row.id),
      ),
    );
  await tx.delete(deviceKitchenScreenStations).where(eq(deviceKitchenScreenStations.stationId, id));
  await tx
    .delete(deviceProfileKitchenScreenStations)
    .where(eq(deviceProfileKitchenScreenStations.stationId, id));
  await tx.delete(deviceKitchenScreenRemovals).where(eq(deviceKitchenScreenRemovals.stationId, id));
  if (rows.daily.length > 0)
    await tx.delete(stationDayStates).where(
      inArray(
        stationDayStates.id,
        rows.daily.map((row) => row.id),
      ),
    );
  if (rows.incoming.length > 0)
    await tx
      .update(stationDayStates)
      .set({ sendsToStationId: null })
      .where(
        inArray(
          stationDayStates.id,
          rows.incoming.map((row) => row.rowId),
        ),
      );
}
