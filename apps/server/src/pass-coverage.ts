import "./errors.js";
import { and, asc, eq } from "drizzle-orm";
import { deviceProfiles, devices, floorZones, kitchenStations } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { deviceBindingColumns, deviceProfileJoin, toDeviceBinding } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, passSees, type PassScope } from "./pass-board.js";
import { passReleaseRefusal } from "./pass-release.js";
import type { TradingContext } from "./trading-context.js";

/** A waiting station and zone no pass device could fire. */
export interface PassCoverageGap {
  stationId: string;
  stationName: string;
  zoneId: string | null;
  zoneName: string | null;
}

/** Each active waiting station in each active zone (or in no zone, when the venue has no active
 *  zone) that no pass device's Fire could release, by zone order, then station name and id. A pass
 *  device passes the Fire's own profile check (`passReleaseRefusal`), is active, and has an
 *  available pass screen; it covers a zone its screen sees and its profile's zone list allows. */
export async function readPassCoverage(
  tx: Transaction,
  cfg: TradingContext,
): Promise<PassCoverageGap[]> {
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.active, true), eq(kitchenStations.waitsForPass, true)))
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  if (stations.length === 0) return [];
  const zones = await tx
    .select({ id: floorZones.id, name: floorZones.name })
    .from(floorZones)
    .where(eq(floorZones.active, true))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));

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

  const pairZones: { id: string | null; name: string | null }[] =
    zones.length === 0 ? [{ id: null, name: null }] : zones;
  const gaps: PassCoverageGap[] = [];
  for (const zone of pairZones)
    for (const station of stations)
      if (
        !passes.some(
          ({ scope, profileZones }) =>
            passSees(scope, { stationId: station.id, zoneId: zone.id }) &&
            (zone.id === null || profileZones === null || profileZones.has(zone.id)),
        )
      )
        gaps.push({
          stationId: station.id,
          stationName: station.name,
          zoneId: zone.id,
          zoneName: zone.name,
        });
  return gaps;
}
