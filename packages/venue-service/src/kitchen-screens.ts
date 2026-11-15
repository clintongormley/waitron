import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  deviceProfileKitchenScreens,
  deviceProfileKitchenScreenStations,
  deviceProfileKitchenScreenZones,
  deviceProfiles,
  devices,
  floorZones,
  KITCHEN_SCREEN_KINDS,
  kitchenStations,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
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

/** The kinds whose rows' `show_non_pass_stations` is read; a station row keeps its default. */
const hasDisplay = (kind: KitchenScreenKind) => kind !== "station";

export async function readProfileKitchenScreens(
  tx: Transaction,
): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]> {
  const profiles = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(asc(deviceProfiles.id));
  const stored = await readStored(tx);
  return profiles.map(({ id }) => ({ profileId: id, screens: stored.get(id) ?? {} }));
}

async function readStored(
  tx: Transaction,
  profileIds?: readonly string[],
): Promise<Map<string, MutableScreens>> {
  const rows = await tx
    .select()
    .from(deviceProfileKitchenScreens)
    .where(
      profileIds === undefined
        ? undefined
        : inArray(deviceProfileKitchenScreens.deviceProfileId, [...profileIds]),
    );
  const stations = await tx
    .select({
      profileId: deviceProfileKitchenScreenStations.deviceProfileId,
      screen: deviceProfileKitchenScreenStations.screen,
      id: kitchenStations.id,
      name: kitchenStations.name,
    })
    .from(deviceProfileKitchenScreenStations)
    .innerJoin(
      kitchenStations,
      eq(kitchenStations.id, deviceProfileKitchenScreenStations.stationId),
    )
    .where(
      and(
        eq(kitchenStations.active, true),
        profileIds === undefined
          ? undefined
          : inArray(deviceProfileKitchenScreenStations.deviceProfileId, [...profileIds]),
      ),
    )
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  stations.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
  const zones = await tx
    .select({
      profileId: deviceProfileKitchenScreenZones.deviceProfileId,
      screen: deviceProfileKitchenScreenZones.screen,
      id: floorZones.id,
    })
    .from(deviceProfileKitchenScreenZones)
    .innerJoin(floorZones, eq(floorZones.id, deviceProfileKitchenScreenZones.zoneId))
    .where(
      and(
        eq(floorZones.active, true),
        profileIds === undefined
          ? undefined
          : inArray(deviceProfileKitchenScreenZones.deviceProfileId, [...profileIds]),
      ),
    )
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));

  const byProfile = new Map<string, MutableScreens>();
  for (const row of rows) {
    const of = (list: readonly { profileId: string; screen: KitchenScreenKind; id: string }[]) =>
      list
        .filter((entry) => entry.profileId === row.deviceProfileId && entry.screen === row.screen)
        .map((entry) => entry.id);
    const screens = byProfile.get(row.deviceProfileId) ?? {};
    screens[row.screen] = {
      stationIds: row.everyStation ? null : of(stations),
      zoneIds: row.screen === "station" || row.everyZone ? null : of(zones),
      ...(hasDisplay(row.screen) ? { showNonPassStations: row.showNonPassStations } : {}),
    };
    byProfile.set(row.deviceProfileId, screens);
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
  const checked: { kind: KitchenScreenKind; scope: ProfileKitchenScreen }[] = [];
  for (const kind of kinds) {
    const scope = screens[kind]!;
    const fields = LIST_FIELDS[kind];
    if (fields.zones === null && scope.zoneIds !== null) refuse("kitchenScreens", "not_for_screen");
    const stationIds = await checkedStations(tx, scope.stationIds, fields);
    const zoneIds = await checkedZones(tx, scope.zoneIds, stored[kind], fields);
    const showNonPassStations = hasDisplay(kind)
      ? (scope.showNonPassStations ?? kept[kind]?.showNonPassStations ?? true)
      : undefined;
    checked.push({ kind, scope: { stationIds, zoneIds, showNonPassStations } });
  }

  await tx
    .delete(deviceProfileKitchenScreens)
    .where(eq(deviceProfileKitchenScreens.deviceProfileId, profileId));
  for (const { kind, scope } of checked) await insertScreen(tx, profileId, kind, scope);
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

async function insertScreen(
  tx: Transaction,
  profileId: string,
  kind: KitchenScreenKind,
  scope: ProfileKitchenScreen,
): Promise<void> {
  const zoneIds = kind === "station" ? [] : scope.zoneIds;
  await tx.insert(deviceProfileKitchenScreens).values({
    deviceProfileId: profileId,
    screen: kind,
    everyStation: scope.stationIds === null,
    everyZone: zoneIds === null,
    showNonPassStations: scope.showNonPassStations ?? true,
  });
  await insertLists(tx, profileId, kind, scope.stationIds ?? [], zoneIds ?? []);
}

async function insertLists(
  tx: Transaction,
  profileId: string,
  kind: KitchenScreenKind,
  stationIds: readonly string[],
  zoneIds: readonly string[],
): Promise<void> {
  if (stationIds.length > 0) {
    await tx
      .insert(deviceProfileKitchenScreenStations)
      .values(
        stationIds.map((stationId) => ({ deviceProfileId: profileId, screen: kind, stationId })),
      )
      .onConflictDoNothing();
  }
  if (zoneIds.length > 0) {
    await tx
      .insert(deviceProfileKitchenScreenZones)
      .values(zoneIds.map((zoneId) => ({ deviceProfileId: profileId, screen: kind, zoneId })))
      .onConflictDoNothing();
  }
}

export async function addProfileKitchenScreen(
  tx: Transaction,
  profileId: string,
  screen: DeviceKitchenScreen,
): Promise<void> {
  const screens = (await readStored(tx, [profileId])).get(profileId) ?? {};
  if (KITCHEN_SCREEN_KINDS.some((kind) => kind !== screen.kind && screens[kind] !== undefined)) {
    refuse("kitchenScreens", "one_only");
  }
  const current = screens[screen.kind];
  if (current === undefined) {
    await insertScreen(tx, profileId, screen.kind, screen);
    return;
  }
  const where = and(
    eq(deviceProfileKitchenScreens.deviceProfileId, profileId),
    eq(deviceProfileKitchenScreens.screen, screen.kind),
  );
  if (current.stationIds !== null && screen.stationIds === null) {
    await tx.update(deviceProfileKitchenScreens).set({ everyStation: true }).where(where);
    await tx
      .delete(deviceProfileKitchenScreenStations)
      .where(
        and(
          eq(deviceProfileKitchenScreenStations.deviceProfileId, profileId),
          eq(deviceProfileKitchenScreenStations.screen, screen.kind),
        ),
      );
  }
  if (screen.kind !== "station" && current.zoneIds !== null && screen.zoneIds === null) {
    await tx.update(deviceProfileKitchenScreens).set({ everyZone: true }).where(where);
    await tx
      .delete(deviceProfileKitchenScreenZones)
      .where(
        and(
          eq(deviceProfileKitchenScreenZones.deviceProfileId, profileId),
          eq(deviceProfileKitchenScreenZones.screen, screen.kind),
        ),
      );
  }
  await insertLists(
    tx,
    profileId,
    screen.kind,
    current.stationIds === null ? [] : (screen.stationIds ?? []),
    screen.kind === "station" || current.zoneIds === null ? [] : (screen.zoneIds ?? []),
  );
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
  const offeredByProfile = await readStored(tx, [
    ...new Set(targets.map((device) => device.profileId)),
  ]);
  const places = await placesHere(tx);
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
    .innerJoin(
      deviceProfileKitchenScreens,
      and(
        eq(deviceProfileKitchenScreens.deviceProfileId, devices.deviceProfileId),
        eq(deviceProfileKitchenScreens.screen, "station"),
      ),
    )
    .where(and(eq(devices.active, true), eq(deviceProfiles.formFactor, SHARED_DISPLAY)))
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
