import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  deviceNotDeleted,
  deviceProfiles,
  devices,
  kitchenStations,
  routingCellPeriods,
  routingCells,
  removeIdFromJson,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  createLabelComparator,
  type DeleteImpactItem,
  type DeleteTarget,
} from "@waitron/shared";
import { readDevicesKitchenScreens } from "./kitchen-screens.js";
import "./errors.js";

export type StationDeleteSettings = { removes: DeleteImpactItem[]; boundScreens: DeleteTarget[] };

async function settings(tx: Transaction, id: string) {
  const [station] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, id), eq(kitchenStations.active, true)));
  if (station === undefined) throw new AppError("station.not_found", { stationId: id });
  const cells = await tx
    .select({ id: routingCells.id })
    .from(routingCells)
    .where(eq(routingCells.stationId, id));
  const periods = await tx
    .select({ id: routingCellPeriods.id })
    .from(routingCellPeriods)
    .where(
      or(
        eq(routingCellPeriods.stationId, id),
        inArray(
          routingCellPeriods.cellId,
          cells.map((row) => row.id),
        ),
      ),
    );
  const profiles = await tx
    .select({ id: deviceProfiles.id, name: deviceProfiles.name })
    .from(deviceProfiles).where(sql`exists (
      select 1 from json_tree(${deviceProfiles.kitchenViews}) as station
      where station.path glob '$.*.stationIds' and station.value = ${id}
    )`);
  const daily = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, id), isNotNull(kitchenStations.closedOnDay)));
  const incoming = await tx
    .select({ rowId: kitchenStations.id, id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(eq(kitchenStations.closedSendsToStationId, id));
  const preferring = await tx
    .select({ rowId: kitchenStations.id, id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(eq(kitchenStations.whenClosedSendsToStationId, id));
  const displays = await tx
    .select({ id: devices.id, name: devices.label })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(and(eq(devices.active, true), deviceNotDeleted(), eq(deviceProfiles.formFactor, "kds")));
  const bound: DeleteTarget[] = [];
  const resolved = await readDevicesKitchenScreens(
    tx,
    displays.map((display) => display.id),
  );
  for (const display of displays) {
    const screens = resolved.get(display.id)!;
    if (
      screens.some(
        (screen) =>
          screen.available &&
          !screen.everyStation &&
          screen.stations.some((slot) => slot.id === id && slot.available),
      )
    )
      bound.push(display);
  }
  const compare = createLabelComparator();
  const targets = (rows: DeleteTarget[]) =>
    [
      ...new Map(
        rows.map((row) => [
          row.id,
          { id: row.id, name: row.name, ...(row.deleted ? { deleted: true } : {}) },
        ]),
      ).values(),
    ].sort((a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id));
  const profileTargets = targets(profiles);
  const destinationTargets = targets(incoming);
  const closedDefaultTargets = targets(preferring);
  const removes: DeleteImpactItem[] = [
    { key: "station_routing_cells", count: cells.length, targets: [] },
    { key: "station_routing_periods", count: periods.length, targets: [] },
    { key: "station_profile_screens", count: profileTargets.length, targets: profileTargets },
    { key: "station_daily_states", count: daily.length, targets: [] },
    {
      key: "station_daily_destinations",
      count: destinationTargets.length,
      targets: destinationTargets,
    },
    {
      key: "station_closed_defaults",
      count: closedDefaultTargets.length,
      targets: closedDefaultTargets,
    },
  ].filter((item) => item.count > 0);
  return {
    cells,
    periods,
    daily,
    incoming,
    preferring,
    impact: { removes, boundScreens: targets(bound) },
  };
}

export async function readStationDeleteSettings(
  tx: Transaction,
  id: string,
): Promise<StationDeleteSettings> {
  return (await settings(tx, id)).impact;
}

export async function clearStationDeleteSettings(tx: Transaction, id: string): Promise<void> {
  const rows = await settings(tx, id);
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
  await removeIdFromJson(tx, deviceProfiles.kitchenViews, id);
  await tx
    .update(kitchenStations)
    .set({ closedOnDay: null, closedSendsToStationId: null, whenClosedSendsToStationId: null })
    .where(eq(kitchenStations.id, id));
  if (rows.incoming.length > 0)
    await tx
      .update(kitchenStations)
      .set({ closedSendsToStationId: null })
      .where(
        inArray(
          kitchenStations.id,
          rows.incoming.map((row) => row.rowId),
        ),
      );
  if (rows.preferring.length > 0)
    await tx
      .update(kitchenStations)
      .set({ whenClosedSendsToStationId: null })
      .where(
        inArray(
          kitchenStations.id,
          rows.preferring.map((row) => row.rowId),
        ),
      );
}
