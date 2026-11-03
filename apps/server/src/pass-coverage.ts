import "./errors.js";
import { and, asc, eq } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { deviceBindingColumns, deviceProfileJoin, toDeviceBinding } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, passSees, type PassScope } from "./pass-board.js";
import { requestedItem } from "./kitchen-phase.js";
import { passReleaseRefusal } from "./pass-release.js";
import type { TradingContext } from "./trading-context.js";
import { orderWatchZones } from "./watch-zones.js";
import { liveKitchenDish } from "./working-order.js";

/** A waiting station and zone no pass device could fire. */
export interface PassCoverageGap {
  stationId: string;
  stationName: string;
  zoneId: string | null;
  zoneName: string | null;
}

/** Each active waiting station in each active zone (or in no zone, when the venue has no active
 *  zone), and each station and zone where a live dish waits for the pass, that no pass device
 *  covers, by zone order (no zone last), then station name and id. A pass device is active, passes
 *  the Fire's profile check (`passReleaseRefusal`) and has an available pass screen; it covers a
 *  station and zone its screen sees, where its profile's zone list allows that zone. */
export async function readPassCoverage(
  tx: Transaction,
  cfg: TradingContext,
): Promise<PassCoverageGap[]> {
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.active, true), eq(kitchenStations.waitsForPass, true)));
  const dishes = await tx
    .select({
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: kitchenStations.id,
      stationName: kitchenStations.name,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    .where(and(liveKitchenDish(), requestedItem()));
  if (stations.length === 0 && dishes.length === 0) return [];
  const allZones = await tx
    .select({ id: floorZones.id, name: floorZones.name, active: floorZones.active })
    .from(floorZones)
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  const zones = allZones.filter((zone) => zone.active);

  const candidates = (
    await tx
      .select({ id: devices.id, ...deviceBindingColumns })
      .from(devices)
      .innerJoin(deviceProfiles, deviceProfileJoin)
      .where(eq(devices.active, true))
  ).filter((row) => passReleaseRefusal(toDeviceBinding(row.id, row)) === null);
  const screens = await VENUE_SERVICE.readDevicesKitchenScreens(
    tx,
    cfg,
    candidates.map((row) => row.id),
  );
  const passes: { scope: PassScope; profileZones: ReadonlySet<string> | null }[] = [];
  const profilesZones = await VENUE_SERVICE.readProfilesZones(tx, [
    ...new Set(candidates.map((row) => row.deviceProfileId)),
  ]);
  for (const row of candidates) {
    const pass = screens.get(row.id)?.find((screen) => screen.kind === "pass");
    if (pass?.available !== true) continue;
    const allowed = profilesZones.get(row.deviceProfileId) ?? null;
    passes.push({
      scope: passScopeOf(pass),
      profileZones: allowed === null ? null : new Set(allowed),
    });
  }

  const pairs = new Map<string, PassCoverageGap>();
  const addPair = (pair: PassCoverageGap) => pairs.set(`${pair.stationId} ${pair.zoneId}`, pair);
  const pairZones: { id: string | null; name: string | null }[] =
    zones.length === 0 ? [{ id: null, name: null }] : zones;
  for (const zone of pairZones)
    for (const station of stations)
      addPair({
        stationId: station.id,
        stationName: station.name,
        zoneId: zone.id,
        zoneName: zone.name,
      });
  const dishZones = await orderWatchZones(tx, cfg, [
    ...new Map(
      dishes.map(({ orderId, partyId, deliveryTableId }) => [
        orderId,
        { id: orderId, partyId, deliveryTableId },
      ]),
    ).values(),
  ]);
  const zoneNames = new Map(allZones.map((zone) => [zone.id, zone.name]));
  for (const dish of dishes) {
    const zoneId = dishZones.get(dish.orderId) ?? null;
    addPair({
      stationId: dish.stationId,
      stationName: dish.stationName,
      zoneId,
      zoneName: zoneId === null ? null : (zoneNames.get(zoneId) ?? null),
    });
  }

  const zoneRank = new Map(allZones.map((zone, index) => [zone.id, index]));
  const rankOf = (zoneId: string | null) =>
    zoneId === null ? allZones.length : (zoneRank.get(zoneId) ?? allZones.length);
  return [...pairs.values()]
    .filter(
      (pair) =>
        !passes.some(
          ({ scope, profileZones }) =>
            passSees(scope, pair) &&
            (pair.zoneId === null || profileZones === null || profileZones.has(pair.zoneId)),
        ),
    )
    .sort(
      (a, b) =>
        rankOf(a.zoneId) - rankOf(b.zoneId) ||
        byCodeUnit(a.stationName, b.stationName) ||
        byCodeUnit(a.stationId, b.stationId),
    );
}

/** Code-unit order, as the database's binary collation sorts. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
