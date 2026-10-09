import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { deviceProfiles, devices, floorZones, kitchenStations } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type {
  DeviceKitchenScreen,
  KitchenScreenKind,
  KitchenScreenScope,
  NarrowedDevice,
  ProfileKitchenScreens,
  ResolvedKitchenScreen,
  ScreenSlot,
} from "@waitron/module";
import { AppError, locationId as brandLocationId, type ErrorParams } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import {
  deviceKitchenScreenRemovals,
  deviceKitchenScreens,
  deviceKitchenScreenStations,
  deviceKitchenScreenZones,
  deviceProfileKitchenScreens,
  deviceProfileKitchenScreenStations,
  deviceProfileKitchenScreenZones,
  KITCHEN_SCREEN_KINDS,
} from "./schema/kitchen-screens.js";
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

type MutableScreens = Partial<Record<KitchenScreenKind, KitchenScreenScope>>;

/** Each live profile's stored kitchen screens, switched-off stations and zones included. */
export async function readProfileKitchenScreens(
  tx: Transaction,
  cfg: VenueScope,
): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]> {
  const profiles = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(asc(deviceProfiles.id));
  const stored = await readStored(tx, cfg);
  return profiles.map(({ id }) => ({ profileId: id, screens: stored.get(id) ?? {} }));
}

async function readStored(
  tx: Transaction,
  cfg: VenueScope,
  profileId?: string,
): Promise<Map<string, MutableScreens>> {
  const rows = await tx
    .select()
    .from(deviceProfileKitchenScreens)
    .where(
      profileId === undefined
        ? undefined
        : eq(deviceProfileKitchenScreens.deviceProfileId, profileId),
    );
  const stations = await tx
    .select({
      profileId: deviceProfileKitchenScreenStations.deviceProfileId,
      screen: deviceProfileKitchenScreenStations.screen,
      id: kitchenStations.id,
    })
    .from(deviceProfileKitchenScreenStations)
    .innerJoin(
      kitchenStations,
      eq(kitchenStations.id, deviceProfileKitchenScreenStations.stationId),
    )
    .where(
      and(
        eq(kitchenStations.locationId, cfg.locationId),
        profileId === undefined
          ? undefined
          : eq(deviceProfileKitchenScreenStations.deviceProfileId, profileId),
      ),
    )
    .orderBy(asc(kitchenStations.displayOrder), asc(kitchenStations.name), asc(kitchenStations.id));
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
        eq(floorZones.locationId, cfg.locationId),
        profileId === undefined
          ? undefined
          : eq(deviceProfileKitchenScreenZones.deviceProfileId, profileId),
      ),
    )
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));

  const byProfile = new Map<string, MutableScreens>();
  for (const row of rows) {
    const of = (list: typeof stations) =>
      list
        .filter((entry) => entry.profileId === row.deviceProfileId && entry.screen === row.screen)
        .map((entry) => entry.id);
    const screens = byProfile.get(row.deviceProfileId) ?? {};
    screens[row.screen] = {
      stationIds: row.everyStation ? null : of(stations),
      zoneIds: row.screen === "station" || row.everyZone ? null : of(zones),
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

/**
 * Replaces all of the profile's kitchen screens. Each station and zone must be switched on here,
 * unless the profile already stores it for the same screen.
 */
export async function setProfileKitchenScreens(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  screens: ProfileKitchenScreens,
): Promise<NarrowedDevice[]> {
  const formFactor = await liveFormFactor(tx, profileId);
  const stored = (await readStored(tx, cfg, profileId)).get(profileId) ?? {};
  const kinds = KITCHEN_SCREEN_KINDS.filter((kind) => screens[kind] !== undefined);
  const checked: { kind: KitchenScreenKind; scope: KitchenScreenScope }[] = [];
  for (const kind of kinds) {
    const scope = screens[kind]!;
    const fields = LIST_FIELDS[kind];
    if (fields.zones === null && scope.zoneIds !== null) refuse("kitchenScreens", "not_for_screen");
    const stationIds = await checkedStations(tx, cfg, scope.stationIds, stored[kind], fields);
    const zoneIds = await checkedZones(tx, cfg, scope.zoneIds, stored[kind], fields);
    checked.push({ kind, scope: { stationIds, zoneIds } });
  }

  // A profile belongs to no location, so its devices are narrowed wherever they are, each
  // against the profile's lists as read at its own location.
  const onProfile = await tx
    .select({ id: devices.id, label: devices.label, locationId: devices.locationId })
    .from(devices)
    .where(eq(devices.deviceProfileId, profileId))
    .orderBy(asc(devices.label), asc(devices.id));
  const locations = [...new Set(onProfile.map((device) => device.locationId))];
  const before = new Map<string, MutableScreens>();
  for (const id of locations) before.set(id, await profileScreensAt(tx, id, profileId));

  await tx
    .delete(deviceProfileKitchenScreens)
    .where(eq(deviceProfileKitchenScreens.deviceProfileId, profileId));
  for (const { kind, scope } of checked) await insertScreen(tx, profileId, kind, scope);

  const narrowed: NarrowedDevice[] = [];
  for (const id of locations) {
    const after = { formFactor, screens: await profileScreensAt(tx, id, profileId) };
    const targets = onProfile.filter((device) => device.locationId === id);
    const scope = { locationId: brandLocationId(id) };
    narrowed.push(...(await narrowDevices(tx, scope, targets, before.get(id)!, after)));
  }
  const order = new Map(onProfile.map((device, index) => [device.id, index]));
  return narrowed.sort((a, b) => order.get(a.deviceId)! - order.get(b.deviceId)!);
}

async function profileScreensAt(
  tx: Transaction,
  locationId: string,
  profileId: string,
): Promise<MutableScreens> {
  const here = { locationId: brandLocationId(locationId) };
  return (await readStored(tx, here, profileId)).get(profileId) ?? {};
}

async function checkedStations(
  tx: Transaction,
  cfg: VenueScope,
  ids: readonly string[] | null,
  stored: KitchenScreenScope | undefined,
  fields: { stations: Field },
): Promise<string[] | null> {
  if (ids === null) return null;
  const unique = [...new Set(ids)];
  if (unique.length === 0) refuse(fields.stations, "empty");
  const found = await tx
    .select({ id: kitchenStations.id, active: kitchenStations.active })
    .from(kitchenStations)
    .where(
      and(inArray(kitchenStations.id, unique), eq(kitchenStations.locationId, cfg.locationId)),
    );
  const usable = found.filter((row) => row.active || stored?.stationIds?.includes(row.id));
  if (usable.length !== unique.length) refuse(fields.stations, "not_found");
  return unique;
}

async function checkedZones(
  tx: Transaction,
  cfg: VenueScope,
  ids: readonly string[] | null,
  stored: KitchenScreenScope | undefined,
  fields: { zones: Field | null },
): Promise<string[] | null> {
  if (ids === null || fields.zones === null) return null;
  const unique = [...new Set(ids)];
  if (unique.length === 0) refuse(fields.zones, "empty");
  const found = await tx
    .select({ id: floorZones.id, active: floorZones.active })
    .from(floorZones)
    .where(and(inArray(floorZones.id, unique), eq(floorZones.locationId, cfg.locationId)));
  const usable = found.filter((row) => row.active || stored?.zoneIds?.includes(row.id));
  if (usable.length !== unique.length) refuse(fields.zones, "not_found");
  return unique;
}

async function insertScreen(
  tx: Transaction,
  profileId: string,
  kind: KitchenScreenKind,
  scope: KitchenScreenScope,
): Promise<void> {
  const zoneIds = kind === "station" ? [] : scope.zoneIds;
  await tx.insert(deviceProfileKitchenScreens).values({
    deviceProfileId: profileId,
    screen: kind,
    everyStation: scope.stationIds === null,
    everyZone: zoneIds === null,
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

/**
 * Adds the screen's stations and zones to the profile's row of its kind, creating the row when
 * there is none. An "every" list stays "every", and "every" given for an explicit list makes it
 * "every"; nothing is removed and no device is narrowed. Unchecked: test set-up only.
 */
export async function addProfileKitchenScreen(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  screen: DeviceKitchenScreen,
): Promise<void> {
  const current = (await readStored(tx, cfg, profileId)).get(profileId)?.[screen.kind];
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

type ChoiceField = ErrorParams["kitchen_screen.invalid"]["field"];
type ChoiceReason = ErrorParams["kitchen_screen.invalid"]["reason"];

function refuseChoice(field: ChoiceField, reason: ChoiceReason): never {
  throw new AppError("kitchen_screen.invalid", { field, reason });
}

interface Place {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

/** The location's stations and zones, switched-off ones included, each in display order. */
async function placesHere(
  tx: Transaction,
  cfg: VenueScope,
): Promise<{ stations: Place[]; zones: Place[] }> {
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name, active: kitchenStations.active })
    .from(kitchenStations)
    .where(eq(kitchenStations.locationId, cfg.locationId))
    .orderBy(asc(kitchenStations.displayOrder), asc(kitchenStations.name), asc(kitchenStations.id));
  const zones = await tx
    .select({ id: floorZones.id, name: floorZones.name, active: floorZones.active })
    .from(floorZones)
    .where(eq(floorZones.locationId, cfg.locationId))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  return { stations, zones };
}

async function readChoices(
  tx: Transaction,
  deviceIds: readonly string[],
): Promise<Map<string, Map<KitchenScreenKind, KitchenScreenScope>>> {
  const rows = await tx
    .select()
    .from(deviceKitchenScreens)
    .where(inArray(deviceKitchenScreens.deviceId, deviceIds));
  const stations = await tx
    .select()
    .from(deviceKitchenScreenStations)
    .where(inArray(deviceKitchenScreenStations.deviceId, deviceIds));
  const zones = await tx
    .select()
    .from(deviceKitchenScreenZones)
    .where(inArray(deviceKitchenScreenZones.deviceId, deviceIds));
  const of = <T extends { deviceId: string; screen: KitchenScreenKind }>(
    list: readonly T[],
    row: { deviceId: string; screen: KitchenScreenKind },
  ) => list.filter((entry) => entry.deviceId === row.deviceId && entry.screen === row.screen);
  const choices = new Map<string, Map<KitchenScreenKind, KitchenScreenScope>>(
    deviceIds.map((id) => [id, new Map()]),
  );
  for (const row of rows) {
    choices.get(row.deviceId)!.set(row.screen, {
      stationIds: row.everyStation ? null : of(stations, row).map((entry) => entry.stationId),
      zoneIds:
        row.screen === "station" || row.everyZone
          ? null
          : of(zones, row).map((entry) => entry.zoneId),
    });
  }
  return choices;
}

/**
 * Checks a device's choice against its profile. `stored` is the device's current choice, whose
 * switched-off stations and zones it may keep.
 */
async function checkChoice(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  screens: readonly DeviceKitchenScreen[],
  stored: ReadonlyMap<KitchenScreenKind, KitchenScreenScope>,
): Promise<void> {
  const sharedDisplay = (await liveFormFactor(tx, profileId)) === SHARED_DISPLAY;
  if (sharedDisplay && screens.length === 0) throw new AppError("kitchen_screen.required", {});
  const kinds = new Set(screens.map((screen) => screen.kind));
  const bothPassKinds = kinds.has("pass") && kinds.has("pass_monitor");
  if (kinds.size !== screens.length || (sharedDisplay && screens.length > 1) || bothPassKinds) {
    refuseChoice("screens", "one_only");
  }
  const offered = (await readStored(tx, cfg, profileId)).get(profileId) ?? {};
  const places = await placesHere(tx, cfg);
  for (const screen of screens) {
    const bound = offered[screen.kind];
    if (bound === undefined && (sharedDisplay || screen.kind === "pass_monitor")) {
      throw new AppError("kitchen_screen.not_allowed", { screen: screen.kind });
    }
    if (screen.kind === "station" && screen.zoneIds !== null) {
      refuseChoice("zoneIds", "not_for_screen");
    }
    const kept = stored.get(screen.kind);
    for (const id of checkedChoice(
      screen.stationIds,
      places.stations,
      kept?.stationIds,
      "stationIds",
    )) {
      if (bound?.stationIds && !bound.stationIds.includes(id)) {
        throw new AppError("station.not_allowed", { stationId: id });
      }
    }
    for (const id of checkedChoice(screen.zoneIds, places.zones, kept?.zoneIds, "zoneIds")) {
      if (bound?.zoneIds && !bound.zoneIds.includes(id)) {
        throw new AppError("kitchen_screen.zone_not_allowed", { zoneId: id });
      }
    }
  }
}

function checkedChoice(
  ids: readonly string[] | null,
  places: readonly Place[],
  kept: readonly string[] | null | undefined,
  field: ChoiceField,
): readonly string[] {
  if (ids === null) return [];
  if (ids.length === 0) refuseChoice(field, "empty");
  for (const id of ids) {
    const place = places.find((entry) => entry.id === id);
    if (place === undefined || !(place.active || kept?.includes(id))) {
      refuseChoice(field, "not_found");
    }
  }
  return ids;
}

/**
 * Checks a device's kitchen screens against the profile without writing them; with `deviceId`, the
 * device keeps what it stores, as `setDeviceKitchenScreens` lets it.
 */
export async function assertDeviceKitchenScreens(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  screens: readonly DeviceKitchenScreen[],
  deviceId?: string,
): Promise<void> {
  const stored =
    deviceId === undefined ? new Map() : (await readChoices(tx, [deviceId])).get(deviceId)!;
  await checkChoice(tx, cfg, profileId, screens, stored);
}

/** Replaces the device's kitchen screens; a pick forgets everything narrowings took from it. */
export async function setDeviceKitchenScreens(
  tx: Transaction,
  cfg: VenueScope,
  input: { deviceId: string; profileId: string; screens: readonly DeviceKitchenScreen[] },
): Promise<void> {
  const { deviceId, profileId, screens } = input;
  const stored = (await readChoices(tx, [deviceId])).get(deviceId)!;
  await checkChoice(tx, cfg, profileId, screens, stored);
  await tx.delete(deviceKitchenScreens).where(eq(deviceKitchenScreens.deviceId, deviceId));
  await tx
    .delete(deviceKitchenScreenRemovals)
    .where(eq(deviceKitchenScreenRemovals.deviceId, deviceId));
  for (const screen of screens) {
    const stationIds = [...new Set(screen.stationIds ?? [])];
    const zoneIds = screen.kind === "station" ? [] : [...new Set(screen.zoneIds ?? [])];
    await tx.insert(deviceKitchenScreens).values({
      deviceId,
      screen: screen.kind,
      everyStation: screen.stationIds === null,
      everyZone: screen.kind !== "station" && screen.zoneIds === null,
    });
    if (stationIds.length > 0) {
      await tx
        .insert(deviceKitchenScreenStations)
        .values(stationIds.map((stationId) => ({ deviceId, screen: screen.kind, stationId })));
    }
    if (zoneIds.length > 0) {
      await tx
        .insert(deviceKitchenScreenZones)
        .values(zoneIds.map((zoneId) => ({ deviceId, screen: screen.kind, zoneId })));
    }
  }
}

/**
 * The slots a list shows: the device's explicit list, or else the profile's (no row or "every"
 * meaning every switched-on one here) less what narrowings took; what they took shows too, as
 * no longer available, and so does a listed one switched off since.
 */
function slots(
  places: readonly Place[],
  chosen: readonly string[] | null,
  bound: readonly string[] | null,
  removed: ReadonlySet<string>,
): ScreenSlot[] {
  const base =
    chosen ??
    bound?.filter((id) => !removed.has(id)) ??
    places.filter((place) => place.active && !removed.has(place.id)).map((place) => place.id);
  const shown = new Set([...base, ...removed]);
  return places
    .filter((place) => shown.has(place.id))
    .map((place) => ({
      id: place.id,
      name: place.name,
      available: place.active && !removed.has(place.id),
      switchedOff: !place.active && !removed.has(place.id),
    }));
}

/** The device's stored kitchen screens, then the kinds a narrowing took from it. */
export async function readDeviceKitchenScreens(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
): Promise<ResolvedKitchenScreen[]> {
  return (await readDevicesKitchenScreens(tx, cfg, [deviceId])).get(deviceId)!;
}

/** Each named device's {@link readDeviceKitchenScreens}; one unknown here reads none. */
export async function readDevicesKitchenScreens(
  tx: Transaction,
  cfg: VenueScope,
  deviceIds: readonly string[],
): Promise<Map<string, ResolvedKitchenScreen[]>> {
  if (deviceIds.length === 0) return new Map();
  const found = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .where(and(inArray(devices.id, [...deviceIds]), eq(devices.locationId, cfg.locationId)));
  const resolved = await resolveDevices(tx, cfg, found);
  return new Map(deviceIds.map((id) => [id, resolved.get(id) ?? []]));
}

/** Each device's resolved kitchen screens, read in a fixed number of queries. */
async function resolveDevices(
  tx: Transaction,
  cfg: VenueScope,
  targets: readonly { id: string; profileId: string }[],
): Promise<Map<string, ResolvedKitchenScreen[]>> {
  if (targets.length === 0) return new Map();
  const ids = targets.map((device) => device.id);
  const choices = await readChoices(tx, ids);
  const allRemovals = await tx
    .select()
    .from(deviceKitchenScreenRemovals)
    .where(inArray(deviceKitchenScreenRemovals.deviceId, ids));
  const offeredByProfile = await readStored(tx, cfg);
  const places = await placesHere(tx, cfg);

  const resolved = new Map<string, ResolvedKitchenScreen[]>();
  for (const device of targets) {
    const choice = choices.get(device.id)!;
    const removals = allRemovals.filter((row) => row.deviceId === device.id);
    const offered = offeredByProfile.get(device.profileId) ?? {};
    const resolve = (kind: KitchenScreenKind): ResolvedKitchenScreen => {
      const ofKind = removals.filter((row) => row.screen === kind);
      const removedStations = new Set(ofKind.flatMap((row) => row.stationId ?? []));
      const removedZones = new Set(ofKind.flatMap((row) => row.zoneId ?? []));
      const chosen = choice.get(kind);
      const bound = offered[kind];
      if (chosen === undefined) {
        return {
          kind,
          available: !ofKind.some((row) => row.stationId === null && row.zoneId === null),
          stations: slots(places.stations, [], null, removedStations),
          zones: removedZones.size === 0 ? null : slots(places.zones, [], null, removedZones),
        };
      }
      const everyZone =
        chosen.zoneIds === null && (bound?.zoneIds ?? null) === null && removedZones.size === 0;
      return {
        kind,
        available: true,
        stations: slots(
          places.stations,
          chosen.stationIds,
          bound?.stationIds ?? null,
          removedStations,
        ),
        zones:
          kind === "station" || everyZone
            ? null
            : slots(places.zones, chosen.zoneIds, bound?.zoneIds ?? null, removedZones),
      };
    };
    resolved.set(
      device.id,
      [
        ...KITCHEN_SCREEN_KINDS.filter((kind) => choice.has(kind)),
        ...KITCHEN_SCREEN_KINDS.filter(
          (kind) => !choice.has(kind) && removals.some((row) => row.screen === kind),
        ),
      ].map(resolve),
    );
  }
  return resolved;
}

/** What a profile offers: its form factor and its stored kitchen screens. */
interface Offer {
  readonly formFactor: string;
  readonly screens: MutableScreens;
}

/**
 * The bound a profile puts on a device's screen of this kind; undefined when it does not offer the
 * kind. A till or handheld profile with no row for a kind bounds nothing.
 */
function boundOf(offer: Offer, kind: KitchenScreenKind): KitchenScreenScope | undefined {
  const row = offer.screens[kind];
  if (row !== undefined) return row;
  if (offer.formFactor === SHARED_DISPLAY || kind === "pass_monitor") return undefined;
  return { stationIds: null, zoneIds: null };
}

/** Station and zone ids are both generated ids, so one key space holds either, or the kind. */
const removalKey = (deviceId: string, kind: KitchenScreenKind, id: string | null) =>
  `${deviceId}|${kind}|${id ?? ""}`;

/**
 * Narrows each target device from what `before` let it show to what `after` allows: an explicit
 * list loses what `after` leaves out, a kind `after` does not offer or a list left empty goes, and
 * each station, zone or kind it showed and lost is recorded once. An "every" list stays "every",
 * its losses recorded. Never refuses, so a kitchen display may be left with no screen.
 */
async function narrowDevices(
  tx: Transaction,
  cfg: VenueScope,
  targets: readonly { id: string; label: string }[],
  before: MutableScreens,
  after: Offer,
): Promise<NarrowedDevice[]> {
  const ids = targets.map((device) => device.id);
  const choices = await readChoices(tx, ids);
  const recorded = await tx
    .select()
    .from(deviceKitchenScreenRemovals)
    .where(inArray(deviceKitchenScreenRemovals.deviceId, ids));
  const recordedKeys = new Set(
    recorded.map((row) => removalKey(row.deviceId, row.screen, row.stationId ?? row.zoneId)),
  );
  const places = await placesHere(tx, cfg);
  const active = (list: readonly Place[]) =>
    list.filter((place) => place.active).map((place) => place.id);

  const removals: (typeof deviceKitchenScreenRemovals.$inferInsert)[] = [];
  const dropped = new Map<KitchenScreenKind, string[]>(KITCHEN_SCREEN_KINDS.map((k) => [k, []]));
  const narrowed: NarrowedDevice[] = [];
  for (const device of targets) {
    const screens: KitchenScreenKind[] = [];
    const stations = new Set<string>();
    const zones = new Set<string>();
    for (const [kind, chosen] of choices.get(device.id)!) {
      const already = (id: string | null) => recordedKeys.has(removalKey(device.id, kind, id));
      const bound = boundOf(after, kind);
      if (bound === undefined) {
        dropped.get(kind)!.push(device.id);
        if (!already(null)) {
          screens.push(kind);
          removals.push({ deviceId: device.id, screen: kind });
        }
        continue;
      }
      const shownBefore = before[kind];
      const lose = (
        chosenIds: readonly string[] | null,
        beforeIds: readonly string[] | null | undefined,
        afterIds: readonly string[] | null,
        all: readonly Place[],
      ) => {
        if (afterIds === null) return { emptied: false, lost: [] as string[] };
        const shown = chosenIds ?? beforeIds ?? active(all);
        const gone = shown.filter((id) => !afterIds.includes(id));
        return {
          emptied: chosenIds !== null && gone.length === chosenIds.length,
          lost: gone.filter((id) => !already(id)),
        };
      };
      const lostStations = lose(
        chosen.stationIds,
        shownBefore?.stationIds,
        bound.stationIds,
        places.stations,
      );
      const lostZones =
        kind === "station"
          ? { emptied: false, lost: [] }
          : lose(chosen.zoneIds, shownBefore?.zoneIds, bound.zoneIds, places.zones);
      if (lostStations.emptied || lostZones.emptied) dropped.get(kind)!.push(device.id);
      for (const stationId of lostStations.lost) {
        stations.add(stationId);
        removals.push({ deviceId: device.id, screen: kind, stationId });
      }
      for (const zoneId of lostZones.lost) {
        zones.add(zoneId);
        removals.push({ deviceId: device.id, screen: kind, zoneId });
      }
    }
    if (screens.length + stations.size + zones.size > 0) {
      const named = (list: readonly Place[], set: ReadonlySet<string>) =>
        list.filter((place) => set.has(place.id)).map(({ id, name }) => ({ id, name }));
      narrowed.push({
        deviceId: device.id,
        deviceName: device.label,
        lost: {
          screens: KITCHEN_SCREEN_KINDS.filter((kind) => screens.includes(kind)),
          stations: named(places.stations, stations),
          zones: named(places.zones, zones),
        },
      });
    }
  }

  for (const kind of KITCHEN_SCREEN_KINDS) {
    const bound = boundOf(after, kind);
    if (bound?.stationIds) {
      await tx
        .delete(deviceKitchenScreenStations)
        .where(
          and(
            eq(deviceKitchenScreenStations.screen, kind),
            inArray(deviceKitchenScreenStations.deviceId, ids),
            notInArray(deviceKitchenScreenStations.stationId, [...bound.stationIds]),
          ),
        );
    }
    if (bound?.zoneIds) {
      await tx
        .delete(deviceKitchenScreenZones)
        .where(
          and(
            eq(deviceKitchenScreenZones.screen, kind),
            inArray(deviceKitchenScreenZones.deviceId, ids),
            notInArray(deviceKitchenScreenZones.zoneId, [...bound.zoneIds]),
          ),
        );
    }
    const gone = dropped.get(kind)!;
    if (gone.length > 0) {
      await tx
        .delete(deviceKitchenScreens)
        .where(
          and(eq(deviceKitchenScreens.screen, kind), inArray(deviceKitchenScreens.deviceId, gone)),
        );
    }
  }
  if (removals.length > 0) await tx.insert(deviceKitchenScreenRemovals).values(removals);
  return narrowed;
}

/**
 * Narrows the device from its current profile to `profileId`, before a switch writes it, against
 * the profiles' lists at the device's own location; null when it loses nothing, or is unknown.
 */
export async function narrowDeviceKitchenScreens(
  tx: Transaction,
  _cfg: VenueScope,
  deviceId: string,
  profileId: string,
): Promise<NarrowedDevice | null> {
  const [device] = await tx
    .select({
      id: devices.id,
      label: devices.label,
      profileId: devices.deviceProfileId,
      locationId: devices.locationId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (device === undefined) return null;
  const after = {
    formFactor: await liveFormFactor(tx, profileId),
    screens: await profileScreensAt(tx, device.locationId, profileId),
  };
  const before = await profileScreensAt(tx, device.locationId, device.profileId);
  const here = { locationId: brandLocationId(device.locationId) };
  const [narrowed] = await narrowDevices(tx, here, [device], before, after);
  return narrowed ?? null;
}

/** Refuses `kitchen_screen.required` when `profileId` is a kitchen display's and the device stores
 *  no kitchen screen. */
export async function assertKitchenDisplayHasScreen(
  tx: Transaction,
  _cfg: VenueScope,
  deviceId: string,
  profileId: string,
): Promise<void> {
  if ((await liveFormFactor(tx, profileId)) !== SHARED_DISPLAY) return;
  if ((await readChoices(tx, [deviceId])).get(deviceId)!.size === 0) {
    throw new AppError("kitchen_screen.required", {});
  }
}

/**
 * Refuses an order's zone (null: in no zone) that the device's pass screen does not show, and any
 * order on a device storing no pass screen: one a narrowing took reads only what it lost.
 */
export async function assertPassScreenZone(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
  zoneId: string | null,
): Promise<void> {
  if (!(await readChoices(tx, [deviceId])).get(deviceId)!.has("pass")) {
    throw new AppError("kitchen_screen.not_allowed", { screen: "pass" });
  }
  const pass = (await readDeviceKitchenScreens(tx, cfg, deviceId)).find(
    (screen) => screen.kind === "pass",
  );
  if (pass === undefined) throw new AppError("kitchen_screen.not_allowed", { screen: "pass" });
  if (pass.zones === null) return;
  if (!pass.zones.some((zone) => zone.available && zone.id === zoneId)) {
    throw new AppError("kitchen_screen.zone_not_allowed", { zoneId });
  }
}

/** Whether the device's `kind` screen and its profile's both list every station, so a station
 *  switched off since drops out of the read rather than showing as no longer available. */
export async function followsEveryStation(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
  kind: KitchenScreenKind,
): Promise<boolean> {
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.locationId, cfg.locationId)));
  if (device === undefined) return false;
  const chosen = (await readChoices(tx, [deviceId])).get(deviceId)!.get(kind);
  const bound = (await readStored(tx, cfg, device.profileId)).get(device.profileId)?.[kind];
  return chosen?.stationIds === null && (bound?.stationIds ?? null) === null;
}

/** Each active kitchen display running a station screen, with the stations it shows now; with
 *  `withSwitchedOff`, also the switched-off ones its explicit list names. A narrowing deletes what
 *  it takes from an explicit list, so a station it took never counts. */
export async function readStationScreens(
  tx: Transaction,
  cfg: VenueScope,
  options: { withSwitchedOff?: boolean } = {},
): Promise<{ deviceId: string; stationIds: string[] }[]> {
  const displays = await tx
    .select({ id: devices.id, profileId: devices.deviceProfileId })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .innerJoin(
      deviceKitchenScreens,
      and(
        eq(deviceKitchenScreens.deviceId, devices.id),
        eq(deviceKitchenScreens.screen, "station"),
      ),
    )
    .where(
      and(
        eq(devices.locationId, cfg.locationId),
        eq(devices.active, true),
        eq(deviceProfiles.formFactor, SHARED_DISPLAY),
      ),
    )
    .orderBy(asc(devices.id));
  const resolved = await resolveDevices(tx, cfg, displays);
  const ids = displays.map((display) => display.id);
  const choices = await readChoices(tx, ids);
  return displays.map(({ id }) => {
    const explicit = new Set(
      options.withSwitchedOff === true ? (choices.get(id)!.get("station")!.stationIds ?? []) : [],
    );
    return {
      deviceId: id,
      stationIds: resolved
        .get(id)!
        .find((screen) => screen.kind === "station")!
        .stations.filter((slot) => slot.available || explicit.has(slot.id))
        .map((slot) => slot.id),
    };
  });
}
