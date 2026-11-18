import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  floorZones,
  KITCHEN_SCREEN_KINDS,
  kitchenStations,
} from "@waitron/db";
import type { StoredKitchenViews, Transaction } from "@waitron/db";
import type {
  DeviceKitchenScreen,
  KitchenScreenKind,
  KitchenScreenScope,
  ProfileKitchenScreen,
  ProfileKitchenScreens,
  ResolvedKitchenScreen,
  ScreenSlot,
} from "@waitron/module";
import { AppError, compareStationNames, type ErrorParams } from "@waitron/shared";
import "./errors.js";

type Field = ErrorParams["device_profile.access_invalid"]["field"];
type Reason = ErrorParams["device_profile.access_invalid"]["reason"];

/** The form factor `@waitron/layouts` treats as a shared kitchen display. */
const SHARED_DISPLAY = "kds";

const LIST_FIELDS: Record<KitchenScreenKind, { stations: Field; zones: Field | null }> = {
  station: { stations: "stationScreenStations", zones: null },
  pass: { stations: "passScreenStations", zones: "passScreenZones" },
  pass_monitor: { stations: "passMonitorStations", zones: "passMonitorZones" },
};

function refuse(field: Field, reason: Reason): never {
  throw new AppError("device_profile.access_invalid", { field, reason });
}

type MutableScreens = Partial<Record<KitchenScreenKind, ProfileKitchenScreen>>;

const hasDisplay = (kind: KitchenScreenKind) => kind !== "station";

export async function readProfileKitchenScreens(
  tx: Transaction,
): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]> {
  const profiles = await tx
    .select({ id: deviceProfiles.id, views: deviceProfiles.kitchenViews })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(asc(deviceProfiles.id));
  const stored = await visibleViews(tx, profiles);
  return profiles.map(({ id }) => ({ profileId: id, screens: stored.get(id) ?? {} }));
}

async function readStored(
  tx: Transaction,
  profileIds: readonly string[],
): Promise<Map<string, MutableScreens>> {
  const profiles = await tx
    .select({ id: deviceProfiles.id, views: deviceProfiles.kitchenViews })
    .from(deviceProfiles)
    .where(inArray(deviceProfiles.id, [...profileIds]));
  return visibleViews(tx, profiles);
}

async function visibleViews(
  tx: Transaction,
  profiles: readonly { id: string; views: StoredKitchenViews }[],
  places?: { stations: Place[]; zones: Place[] },
): Promise<Map<string, MutableScreens>> {
  const byProfile = new Map<string, MutableScreens>();
  const configured = profiles.filter(({ views }) => Object.keys(views).length > 0);
  if (configured.length === 0) return byProfile;
  const { stations, zones } = places ?? (await placesHere(tx));
  const visible = (ids: readonly string[] | null, places: readonly Place[]) =>
    ids === null ? null : places.filter(({ id }) => ids.includes(id)).map(({ id }) => id);
  for (const { id, views } of configured) {
    const screens: MutableScreens = {};
    for (const kind of KITCHEN_SCREEN_KINDS) {
      const view = views[kind];
      if (view === undefined) continue;
      screens[kind] = {
        stationIds: visible(view.stationIds, stations),
        zoneIds: kind === "station" ? null : visible(view.zoneIds, zones),
        ...(hasDisplay(kind) ? { showNonPassStations: view.showNonPassStations ?? true } : {}),
      };
    }
    byProfile.set(id, screens);
  }
  return byProfile;
}

async function liveFormFactor(tx: Transaction, profileId: string): Promise<string> {
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), isNull(deviceProfiles.retiredAt)));
  if (profile === undefined) refuse("profileId", "not_found");
  return profile.formFactor;
}

export async function setProfileKitchenScreens(
  tx: Transaction,
  profileId: string,
  screens: ProfileKitchenScreens,
): Promise<void> {
  const stored = (await readStored(tx, [profileId])).get(profileId) ?? {};
  return replaceProfileKitchenScreens(tx, profileId, screens, stored, stored);
}

export async function copyProfileKitchenScreens(
  tx: Transaction,
  sourceId: string,
  targetId: string,
): Promise<void> {
  await liveFormFactor(tx, sourceId);
  const stored = (await readStored(tx, [sourceId])).get(sourceId) ?? {};
  await replaceProfileKitchenScreens(tx, targetId, stored, stored, {});
}

async function replaceProfileKitchenScreens(
  tx: Transaction,
  profileId: string,
  screens: ProfileKitchenScreens,
  stored: MutableScreens,
  /** The target's own stored screens, whose display values a screen omitting one keeps. */
  kept: MutableScreens,
): Promise<void> {
  await liveFormFactor(tx, profileId);
  const kinds = KITCHEN_SCREEN_KINDS.filter((kind) => screens[kind] !== undefined);
  if (kinds.length > 1) refuse("kitchenScreens", "one_only");
  const views: StoredKitchenViews = {};
  for (const kind of kinds) {
    const scope = screens[kind]!;
    const fields = LIST_FIELDS[kind];
    if (fields.zones === null && scope.zoneIds !== null) refuse("kitchenScreens", "not_for_screen");
    const stationIds = await checkedStations(tx, scope.stationIds, fields);
    const zoneIds = await checkedZones(tx, scope.zoneIds, stored[kind], fields);
    const showNonPassStations = hasDisplay(kind)
      ? (scope.showNonPassStations ?? kept[kind]?.showNonPassStations ?? true)
      : undefined;
    views[kind] = { stationIds, zoneIds, showNonPassStations };
  }

  await tx
    .update(deviceProfiles)
    .set({ kitchenViews: views })
    .where(eq(deviceProfiles.id, profileId));
}

async function checkedStations(
  tx: Transaction,
  ids: readonly string[] | null,
  fields: { stations: Field },
): Promise<string[] | null> {
  if (ids === null) return null;
  const unique = [...new Set(ids)];
  if (unique.length === 0) refuse(fields.stations, "empty");
  const found = await tx
    .select({ id: kitchenStations.id, active: kitchenStations.active })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, unique));
  const usable = found.filter((row) => row.active);
  if (usable.length !== unique.length) refuse(fields.stations, "not_found");
  return unique;
}

async function checkedZones(
  tx: Transaction,
  ids: readonly string[] | null,
  stored: KitchenScreenScope | undefined,
  fields: { zones: Field | null },
): Promise<string[] | null> {
  if (ids === null || fields.zones === null) return null;
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    if (stored?.zoneIds?.length === 0) return [];
    refuse(fields.zones, "empty");
  }
  const found = await tx
    .select({ id: floorZones.id, active: floorZones.active })
    .from(floorZones)
    .where(inArray(floorZones.id, unique));
  const usable = found.filter((row) => row.active);
  if (usable.length !== unique.length) refuse(fields.zones, "not_found");
  return unique;
}

export async function addProfileKitchenScreen(
  tx: Transaction,
  profileId: string,
  screen: DeviceKitchenScreen,
): Promise<void> {
  const [profile] = await tx
    .select({ views: deviceProfiles.kitchenViews })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  if (profile === undefined) refuse("profileId", "not_found");
  const { views } = profile;
  const { kind } = screen;
  if (KITCHEN_SCREEN_KINDS.some((other) => other !== kind && views[other] !== undefined)) {
    refuse("kitchenScreens", "one_only");
  }
  const current = views[kind];
  const merge = (before: readonly string[] | undefined | null, added: readonly string[] | null) =>
    before === null || added === null ? null : [...new Set([...(before ?? []), ...added])];
  views[kind] = {
    stationIds: merge(current?.stationIds, screen.stationIds),
    zoneIds: kind === "station" ? null : merge(current?.zoneIds, screen.zoneIds),
    ...(hasDisplay(kind) ? { showNonPassStations: current?.showNonPassStations ?? true } : {}),
  };
  await tx
    .update(deviceProfiles)
    .set({ kitchenViews: views })
    .where(eq(deviceProfiles.id, profileId));
}

interface Place {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

async function placesHere(tx: Transaction): Promise<{ stations: Place[]; zones: Place[] }> {
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name, active: kitchenStations.active })
    .from(kitchenStations)
    .where(eq(kitchenStations.active, true))
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  stations.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
  const zones = await tx
    .select({ id: floorZones.id, name: floorZones.name, active: floorZones.active })
    .from(floorZones)
    .where(eq(floorZones.active, true))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  return { stations, zones };
}

export async function readDeviceKitchenScreens(
  tx: Transaction,
  deviceId: string,
): Promise<ResolvedKitchenScreen[]> {
  return (await readDevicesKitchenScreens(tx, [deviceId])).get(deviceId)!;
}

/** Each named device's {@link readDeviceKitchenScreens}; one unknown reads none. */
export async function readDevicesKitchenScreens(
  tx: Transaction,
  deviceIds: readonly string[],
): Promise<Map<string, ResolvedKitchenScreen[]>> {
  if (deviceIds.length === 0) return new Map();
  const found = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .where(inArray(devices.id, [...deviceIds]));
  const resolved = await resolveDevices(tx, found);
  return new Map(deviceIds.map((id) => [id, resolved.get(id) ?? []]));
}

/** Each device's resolved kitchen screens, read in a fixed number of queries. */
async function resolveDevices(
  tx: Transaction,
  targets: readonly { id: string; profileId: string }[],
): Promise<Map<string, ResolvedKitchenScreen[]>> {
  if (targets.length === 0) return new Map();
  const profiles = await tx
    .select({ id: deviceProfiles.id, views: deviceProfiles.kitchenViews })
    .from(deviceProfiles)
    .where(inArray(deviceProfiles.id, [...new Set(targets.map((device) => device.profileId))]));
  const places = await placesHere(tx);
  const offeredByProfile = await visibleViews(tx, profiles, places);
  const slotsOf = (places: readonly Place[], ids: readonly string[] | null): ScreenSlot[] =>
    places
      .filter((place) => ids === null || ids.includes(place.id))
      .map((place) => ({
        id: place.id,
        name: place.name,
        available: place.active,
        switchedOff: !place.active,
      }));
  return new Map(
    targets.map((device) => {
      const offered = offeredByProfile.get(device.profileId) ?? {};
      const screens = KITCHEN_SCREEN_KINDS.flatMap((kind): ResolvedKitchenScreen[] => {
        const scope = offered[kind];
        if (scope === undefined) return [];
        return [
          {
            kind,
            available: true,
            everyStation: scope.stationIds === null,
            everyZone: scope.zoneIds === null,
            stations: slotsOf(places.stations, scope.stationIds),
            zones:
              kind === "station" || scope.zoneIds === null
                ? null
                : slotsOf(places.zones, scope.zoneIds),
            showNonPassStations: scope.showNonPassStations ?? true,
          },
        ];
      });
      return [device.id, screens];
    }),
  );
}

/** An explicit empty zone bound must never become unrestricted access. */
export async function assertPassScreenZone(
  tx: Transaction,
  deviceId: string,
  zoneId: string | null,
): Promise<void> {
  const [device] = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) throw new AppError("kitchen_screen.not_allowed", { screen: "pass" });
  const pass = (await resolveDevices(tx, [device]))
    .get(deviceId)!
    .find((screen) => screen.kind === "pass");
  if (pass === undefined) throw new AppError("kitchen_screen.not_allowed", { screen: "pass" });
  if (pass.zones === null) return;
  if (!pass.zones.some((zone) => zone.available && zone.id === zoneId)) {
    throw new AppError("kitchen_screen.zone_not_allowed", { zoneId });
  }
}

export async function readStationScreens(
  tx: Transaction,
): Promise<{ deviceId: string; stationIds: string[] }[]> {
  const displays = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(
      and(
        eq(devices.active, true),
        eq(deviceProfiles.formFactor, SHARED_DISPLAY),
        sql`json_type(${deviceProfiles.kitchenViews}, '$.station') = 'object'`,
      ),
    )
    .orderBy(asc(devices.id));
  const resolved = await resolveDevices(tx, displays);
  return displays.map(({ id }) => ({
    deviceId: id,
    stationIds: resolved
      .get(id)!
      .find((screen) => screen.kind === "station")!
      .stations.filter((slot) => slot.available)
      .map((slot) => slot.id),
  }));
}
