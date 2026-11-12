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
import { isSharedDisplay } from "@waitron/layouts";
import { deviceBindingColumns, deviceProfileJoin, toDeviceBinding } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, passSees, rowsWatchZones, type PassScope } from "./pass-board.js";
import { requestedItem } from "./kitchen-phase.js";
import { passReleaseRefusal } from "./pass-release.js";
import { byText } from "./text-order.js";
import { liveKitchenDish } from "./kitchen-print.js";

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
 *  the Fire's profile check (`passReleaseRefusal`) and has an available pass screen, and a till or
 *  handheld's profile also has the Pass button on (`show-expo`), without which the till never opens
 *  the pass though its Fire would answer; it covers a station and zone its screen sees, where its
 *  profile's zone list allows that zone. A pair in no zone needs no allowance from the list, as at
 *  the Fire (`assertSubjectZones`). */
export async function readPassCoverage(tx: Transaction): Promise<PassCoverageGap[]> {
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.active, true), eq(kitchenStations.waitsForPass, true)));
  const dishes = await tx
    .selectDistinct({
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
  ).filter((row) => {
    const device = toDeviceBinding(row.id, row);
    return (
      passReleaseRefusal(device) === null &&
      (isSharedDisplay(device.formFactor) || device.capabilities.includes("show-expo"))
    );
  });
  const screens = await VENUE_SERVICE.readDevicesKitchenScreens(
    tx,
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
  const dishZones = await rowsWatchZones(tx, dishes);
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
        byText(a.stationName, b.stationName) ||
        byText(a.stationId, b.stationId),
    );
}
