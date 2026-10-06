import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { deviceProfiles, devices, floorZones, kitchenStations, watchers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, type ErrorParams } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import {
  departments,
  deviceProfileServiceAccess,
  deviceProfileStations,
  deviceProfileWatchers,
  deviceProfileZones,
  zoneServicePolicies,
} from "./schema/service.js";
import "./errors.js";

/**
 * A profile's service scope, resolved against the venue's current rows. `departmentId` null means no
 * department restriction, and `allowedZoneIds` and `startingZoneId` are then null too. A shared
 * display (`kds`) always reads that way: a save refuses it a department or zones, and the read
 * ignores any stored before the profile became one. With a department, `allowedZoneIds` lists the zones the
 * profile may order in now, by position, and `startingZoneId` is its stored starting zone while
 * that is still allowed, otherwise the first allowed zone; an empty list and a null starting zone
 * mean the profile cannot order.
 */
export interface ProfileServiceAccess {
  departmentId: string | null;
  allowedZoneIds: string[] | null;
  startingZoneId: string | null;
  stationIds: string[];
  watcherIds: string[];
}

/** `allowedZoneIds` null means every active zone of the department, decided when read. */
export interface ProfileServiceAccessInput {
  departmentId: string | null;
  allowedZoneIds: readonly string[] | null;
  startingZoneId: string | null;
  stationIds: readonly string[];
  watcherIds: readonly string[];
}

type Refusal = ErrorParams["device_profile.access_invalid"];

/** The form factor `@waitron/layouts` treats as a shared kitchen display. */
const SHARED_DISPLAY = "kds";

function refuse(field: Refusal["field"], reason: Refusal["reason"]): never {
  throw new AppError("device_profile.access_invalid", { field, reason });
}

export async function readProfileServiceAccess(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
): Promise<ProfileServiceAccess> {
  const zones = await readProfileZones(tx, cfg, profileId);
  const stationIds = (
    await tx
      .select({ id: kitchenStations.id })
      .from(deviceProfileStations)
      .innerJoin(kitchenStations, eq(kitchenStations.id, deviceProfileStations.stationId))
      .where(
        and(
          eq(deviceProfileStations.deviceProfileId, profileId),
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.active, true),
        ),
      )
      .orderBy(
        asc(kitchenStations.displayOrder),
        asc(kitchenStations.name),
        asc(kitchenStations.id),
      )
  ).map((row) => row.id);
  const watcherIds = (
    await tx
      .select({ id: watchers.id })
      .from(deviceProfileWatchers)
      .innerJoin(watchers, eq(watchers.id, deviceProfileWatchers.watcherId))
      .where(
        and(
          eq(deviceProfileWatchers.deviceProfileId, profileId),
          eq(watchers.locationId, cfg.locationId),
          eq(watchers.active, true),
        ),
      )
      .orderBy(asc(watchers.displayOrder), asc(watchers.name), asc(watchers.id))
  ).map((row) => row.id);
  return { ...zones, stationIds, watcherIds };
}

/**
 * Refuses `service_zone.not_allowed` when the profile has a department and `zoneId` is not one of
 * the zones it may order in now, read as {@link readProfileServiceAccess} reads them. A profile with
 * no department restriction may use any zone.
 */
export async function assertProfileZone(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  zoneId: string,
): Promise<void> {
  const { allowedZoneIds } = await readProfileZones(tx, cfg, profileId);
  if (allowedZoneIds !== null && !allowedZoneIds.includes(zoneId)) {
    throw new AppError("service_zone.not_allowed", { zoneId });
  }
}

/** The zone half of {@link ProfileServiceAccess}. */
export async function readProfileZones(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
): Promise<Pick<ProfileServiceAccess, "departmentId" | "allowedZoneIds" | "startingZoneId">> {
  const [profile] = await tx
    .select({
      formFactor: deviceProfiles.formFactor,
      departmentId: deviceProfileServiceAccess.departmentId,
      everyZone: deviceProfileServiceAccess.everyZone,
      startingZoneId: deviceProfileServiceAccess.startingZoneId,
    })
    .from(deviceProfiles)
    .leftJoin(
      deviceProfileServiceAccess,
      eq(deviceProfileServiceAccess.deviceProfileId, deviceProfiles.id),
    )
    .where(eq(deviceProfiles.id, profileId));
  if (profile === undefined) refuse("profileId", "not_found");

  if (
    profile.formFactor === SHARED_DISPLAY ||
    profile.departmentId === null ||
    profile.startingZoneId === null
  ) {
    return { departmentId: null, allowedZoneIds: null, startingZoneId: null };
  }

  const allowedZoneIds = (
    await tx
      .select({ id: floorZones.id })
      .from(zoneServicePolicies)
      .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
      .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
      .where(
        and(
          eq(zoneServicePolicies.locationId, cfg.locationId),
          eq(zoneServicePolicies.departmentId, profile.departmentId),
          eq(floorZones.active, true),
          eq(departments.active, true),
          profile.everyZone
            ? undefined
            : inArray(
                floorZones.id,
                tx
                  .select({ id: deviceProfileZones.zoneId })
                  .from(deviceProfileZones)
                  .where(eq(deviceProfileZones.deviceProfileId, profileId)),
              ),
        ),
      )
      .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id))
  ).map((row) => row.id);

  return {
    departmentId: profile.departmentId,
    allowedZoneIds,
    startingZoneId: allowedZoneIds.includes(profile.startingZoneId)
      ? profile.startingZoneId
      : (allowedZoneIds[0] ?? null),
  };
}

/** The department and zone half of {@link ProfileServiceAccessInput}. */
export type ProfileServiceScope = Pick<
  ProfileServiceAccessInput,
  "departmentId" | "allowedZoneIds" | "startingZoneId"
>;

export interface StoredProfileServiceScope {
  profileId: string;
  departmentId: string | null;
  allowedZoneIds: string[] | null;
  startingZoneId: string | null;
}

/** Replaces the profile's whole service scope, after checking every id against the venue's rows. */
export async function setProfileServiceAccess(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  input: ProfileServiceAccessInput,
): Promise<void> {
  const scope = await checkedScope(tx, cfg, await liveFormFactor(tx, profileId), input);
  await checkLists(tx, cfg, profileId, input, await storedLists(tx, profileId));
  await writeScope(tx, profileId, scope);
  await writeLists(tx, profileId, input);
}

const NO_SCOPE: ProfileServiceScope = {
  departmentId: null,
  allowedZoneIds: null,
  startingZoneId: null,
};

/**
 * Replaces the profile's department, zones and starting zone, checked as
 * {@link setProfileServiceAccess} checks them, except that a profile other than a shared display
 * must name a department; its station and watcher lists stay as stored. A field `input` leaves out
 * keeps its stored value, as {@link readProfileServiceScopes} reads it, and an `input` naming none
 * of them leaves a stored department's scope untouched. A shared display starts from no scope, so
 * one stored before the profile became one is cleared.
 */
export async function setProfileServiceScope(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  input: Partial<ProfileServiceScope>,
): Promise<void> {
  const formFactor = await liveFormFactor(tx, profileId);
  const omitted = (Object.keys(NO_SCOPE) as (keyof ProfileServiceScope)[]).filter(
    (field) => input[field] === undefined,
  );
  let base = NO_SCOPE;
  if (formFactor !== SHARED_DISPLAY && omitted.length > 0) {
    const [stored] = await readProfileServiceScopes(tx, [profileId]);
    base = stored!;
    if (omitted.length === 3 && base.departmentId !== null) return;
  }
  const scope: ProfileServiceScope = {
    departmentId: input.departmentId === undefined ? base.departmentId : input.departmentId,
    allowedZoneIds: input.allowedZoneIds === undefined ? base.allowedZoneIds : input.allowedZoneIds,
    startingZoneId: input.startingZoneId === undefined ? base.startingZoneId : input.startingZoneId,
  };
  if (formFactor !== SHARED_DISPLAY && scope.departmentId === null)
    refuse("departmentId", "required");
  await writeScope(tx, profileId, await checkedScope(tx, cfg, formFactor, scope));
}

/**
 * Each profile's scope as a manager last saved it, for the profiles `profileIds` names: unlike
 * {@link readProfileZones}, `allowedZoneIds` null means every zone of the department, and a zone
 * or department switched off since is still named. A profile with no saved scope reads all null.
 */
export async function readProfileServiceScopes(
  tx: Transaction,
  profileIds: readonly string[],
): Promise<StoredProfileServiceScope[]> {
  if (profileIds.length === 0) return [];
  const scopes = await tx
    .select({
      profileId: deviceProfileServiceAccess.deviceProfileId,
      departmentId: deviceProfileServiceAccess.departmentId,
      everyZone: deviceProfileServiceAccess.everyZone,
      startingZoneId: deviceProfileServiceAccess.startingZoneId,
    })
    .from(deviceProfileServiceAccess)
    .where(inArray(deviceProfileServiceAccess.deviceProfileId, [...profileIds]));
  const zones = await tx
    .select({ profileId: deviceProfileZones.deviceProfileId, zoneId: deviceProfileZones.zoneId })
    .from(deviceProfileZones)
    .innerJoin(floorZones, eq(floorZones.id, deviceProfileZones.zoneId))
    .where(inArray(deviceProfileZones.deviceProfileId, [...profileIds]))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  return profileIds.map((profileId) => {
    const scope = scopes.find((row) => row.profileId === profileId);
    if (scope === undefined)
      return { profileId, departmentId: null, allowedZoneIds: null, startingZoneId: null };
    return {
      profileId,
      departmentId: scope.departmentId,
      allowedZoneIds: scope.everyZone
        ? null
        : zones.filter((row) => row.profileId === profileId).map((row) => row.zoneId),
      startingZoneId: scope.startingZoneId,
    };
  });
}

async function liveFormFactor(tx: Transaction, profileId: string): Promise<string> {
  const [profile] = await tx
    .select({ formFactor: deviceProfiles.formFactor })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), isNull(deviceProfiles.retiredAt)));
  if (profile === undefined) refuse("profileId", "not_found");
  return profile.formFactor;
}

async function writeScope(
  tx: Transaction,
  profileId: string,
  scope: { departmentId: string; zoneIds: string[] | null; startingZoneId: string } | null,
): Promise<void> {
  // Deleting the scope row also deletes its `device_profile_zones` rows, through their key.
  await tx
    .delete(deviceProfileServiceAccess)
    .where(eq(deviceProfileServiceAccess.deviceProfileId, profileId));
  if (scope === null) return;
  await tx.insert(deviceProfileServiceAccess).values({
    deviceProfileId: profileId,
    departmentId: scope.departmentId,
    everyZone: scope.zoneIds === null,
    startingZoneId: scope.startingZoneId,
  });
  if (scope.zoneIds !== null) {
    await tx
      .insert(deviceProfileZones)
      .values(scope.zoneIds.map((zoneId) => ({ deviceProfileId: profileId, zoneId })));
  }
}

/** The stations and watchers a device using the profile may show. */
export interface ProfileKitchenLists {
  stationIds: readonly string[];
  watcherIds: readonly string[];
}

/** Each live profile's stored lists, switched-off stations and watchers included, by position. */
export async function readProfileKitchenLists(
  tx: Transaction,
  cfg: VenueScope,
): Promise<{ profileId: string; stationIds: string[]; watcherIds: string[] }[]> {
  const stations = await tx
    .select({ profileId: deviceProfileStations.deviceProfileId, id: kitchenStations.id })
    .from(deviceProfileStations)
    .innerJoin(kitchenStations, eq(kitchenStations.id, deviceProfileStations.stationId))
    .where(eq(kitchenStations.locationId, cfg.locationId))
    .orderBy(asc(kitchenStations.displayOrder), asc(kitchenStations.name), asc(kitchenStations.id));
  const listed = await tx
    .select({ profileId: deviceProfileWatchers.deviceProfileId, id: watchers.id })
    .from(deviceProfileWatchers)
    .innerJoin(watchers, eq(watchers.id, deviceProfileWatchers.watcherId))
    .where(eq(watchers.locationId, cfg.locationId))
    .orderBy(asc(watchers.displayOrder), asc(watchers.name), asc(watchers.id));
  const profiles = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(asc(deviceProfiles.id));
  return profiles.map(({ id }) => ({
    profileId: id,
    stationIds: stations.filter((row) => row.profileId === id).map((row) => row.id),
    watcherIds: listed.filter((row) => row.profileId === id).map((row) => row.id),
  }));
}

/**
 * Replaces the profile's station and watcher lists, checked as {@link setProfileServiceAccess}
 * checks them; a list `input` does not name stays as stored.
 */
export async function setProfileKitchenLists(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  input: Partial<ProfileKitchenLists>,
): Promise<void> {
  const [profile] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), isNull(deviceProfiles.retiredAt)));
  if (profile === undefined) refuse("profileId", "not_found");
  const stored = await storedLists(tx, profileId);
  const lists = {
    stationIds: input.stationIds ?? stored.stationIds,
    watcherIds: input.watcherIds ?? stored.watcherIds,
  };
  await checkLists(tx, cfg, profileId, lists, stored);
  await writeLists(tx, profileId, lists);
}

/** The profile's list rows as stored, whatever the state of each station or watcher. */
async function storedLists(tx: Transaction, profileId: string): Promise<ProfileKitchenLists> {
  const stationIds = (
    await tx
      .select({ id: deviceProfileStations.stationId })
      .from(deviceProfileStations)
      .where(eq(deviceProfileStations.deviceProfileId, profileId))
  ).map((row) => row.id);
  const watcherIds = (
    await tx
      .select({ id: deviceProfileWatchers.watcherId })
      .from(deviceProfileWatchers)
      .where(eq(deviceProfileWatchers.deviceProfileId, profileId))
  ).map((row) => row.id);
  return { stationIds, watcherIds };
}

/**
 * Refuses `station.not_allowed` or `watcher.not_allowed` unless the profile's stored list names the
 * device's station or watcher. An empty list names nothing, so it permits nothing. A listed one
 * switched off since still passes: whether it is switched on is the caller's check.
 */
export async function assertProfileBinding(
  tx: Transaction,
  profileId: string,
  binding: { stationId: string | null; watcherId: string | null },
): Promise<void> {
  if (binding.stationId !== null) {
    const [listed] = await tx
      .select({ id: deviceProfileStations.stationId })
      .from(deviceProfileStations)
      .where(
        and(
          eq(deviceProfileStations.deviceProfileId, profileId),
          eq(deviceProfileStations.stationId, binding.stationId),
        ),
      );
    if (listed === undefined)
      throw new AppError("station.not_allowed", { stationId: binding.stationId });
  }
  if (binding.watcherId !== null) {
    const [listed] = await tx
      .select({ id: deviceProfileWatchers.watcherId })
      .from(deviceProfileWatchers)
      .where(
        and(
          eq(deviceProfileWatchers.deviceProfileId, profileId),
          eq(deviceProfileWatchers.watcherId, binding.watcherId),
        ),
      );
    if (listed === undefined)
      throw new AppError("watcher.not_allowed", { watcherId: binding.watcherId });
  }
}

/**
 * Each id must be switched on at this location, unless the profile already lists it. Removing one an
 * active device on this profile shows is refused, naming that device.
 */
async function checkLists(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  input: ProfileKitchenLists,
  stored: ProfileKitchenLists,
): Promise<void> {
  const stationIds = [...new Set(input.stationIds)];
  const watcherIds = [...new Set(input.watcherIds)];
  const storedStations = stored.stationIds;
  const storedWatchers = stored.watcherIds;
  if (stationIds.length > 0) {
    const found = await tx
      .select({ id: kitchenStations.id, active: kitchenStations.active })
      .from(kitchenStations)
      .where(
        and(
          inArray(kitchenStations.id, stationIds),
          eq(kitchenStations.locationId, cfg.locationId),
        ),
      );
    const usable = found.filter((row) => row.active || storedStations.includes(row.id));
    if (usable.length !== stationIds.length) refuse("stationIds", "not_found");
  }
  if (watcherIds.length > 0) {
    const found = await tx
      .select({ id: watchers.id, active: watchers.active })
      .from(watchers)
      .where(and(inArray(watchers.id, watcherIds), eq(watchers.locationId, cfg.locationId)));
    const usable = found.filter((row) => row.active || storedWatchers.includes(row.id));
    if (usable.length !== watcherIds.length) refuse("watcherIds", "not_found");
  }

  const removedStations = storedStations.filter((id) => !stationIds.includes(id));
  if (removedStations.length > 0) {
    const [user] = await tx
      .select({ id: devices.id, name: devices.label, stationId: devices.stationId })
      .from(devices)
      .where(
        and(
          eq(devices.deviceProfileId, profileId),
          eq(devices.active, true),
          inArray(devices.stationId, removedStations),
        ),
      )
      .orderBy(asc(devices.label), asc(devices.id))
      .limit(1);
    if (user !== undefined)
      throw new AppError("device_profile.station_in_use", {
        stationId: user.stationId!,
        deviceId: user.id,
        deviceName: user.name,
      });
  }
  const removedWatchers = storedWatchers.filter((id) => !watcherIds.includes(id));
  if (removedWatchers.length > 0) {
    const [user] = await tx
      .select({ id: devices.id, name: devices.label, watcherId: devices.watcherId })
      .from(devices)
      .where(
        and(
          eq(devices.deviceProfileId, profileId),
          eq(devices.active, true),
          inArray(devices.watcherId, removedWatchers),
        ),
      )
      .orderBy(asc(devices.label), asc(devices.id))
      .limit(1);
    if (user !== undefined)
      throw new AppError("device_profile.watcher_in_use", {
        watcherId: user.watcherId!,
        deviceId: user.id,
        deviceName: user.name,
      });
  }
}

async function writeLists(
  tx: Transaction,
  profileId: string,
  input: ProfileKitchenLists,
): Promise<void> {
  const stationIds = [...new Set(input.stationIds)];
  const watcherIds = [...new Set(input.watcherIds)];
  await tx
    .delete(deviceProfileStations)
    .where(eq(deviceProfileStations.deviceProfileId, profileId));
  if (stationIds.length > 0) {
    await tx
      .insert(deviceProfileStations)
      .values(stationIds.map((stationId) => ({ deviceProfileId: profileId, stationId })));
  }
  await tx
    .delete(deviceProfileWatchers)
    .where(eq(deviceProfileWatchers.deviceProfileId, profileId));
  if (watcherIds.length > 0) {
    await tx
      .insert(deviceProfileWatchers)
      .values(watcherIds.map((watcherId) => ({ deviceProfileId: profileId, watcherId })));
  }
}

async function checkedScope(
  tx: Transaction,
  cfg: VenueScope,
  formFactor: string,
  input: ProfileServiceScope,
): Promise<{ departmentId: string; zoneIds: string[] | null; startingZoneId: string } | null> {
  if (formFactor === SHARED_DISPLAY) {
    if (input.departmentId !== null) refuse("departmentId", "shared_display");
    if (input.allowedZoneIds !== null) refuse("allowedZoneIds", "shared_display");
    if (input.startingZoneId !== null) refuse("startingZoneId", "shared_display");
  }
  if (input.departmentId === null) {
    if (input.allowedZoneIds !== null) refuse("allowedZoneIds", "department_required");
    if (input.startingZoneId !== null) refuse("startingZoneId", "department_required");
    return null;
  }
  const departmentId = input.departmentId;
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined) refuse("departmentId", "not_found");

  const zoneIds = input.allowedZoneIds === null ? null : [...new Set(input.allowedZoneIds)];
  if (zoneIds !== null && zoneIds.length === 0) refuse("allowedZoneIds", "empty");
  if (input.startingZoneId === null) refuse("startingZoneId", "required");
  const startingZoneId = input.startingZoneId;

  const named = [...new Set([...(zoneIds ?? []), startingZoneId])];
  const zones = new Map(
    (
      await tx
        .select({
          id: floorZones.id,
          active: floorZones.active,
          departmentId: zoneServicePolicies.departmentId,
        })
        .from(floorZones)
        .leftJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
        .where(and(inArray(floorZones.id, named), eq(floorZones.locationId, cfg.locationId)))
    ).map((zone) => [zone.id, zone]),
  );
  const check = (field: "allowedZoneIds" | "startingZoneId", zoneId: string) => {
    const zone = zones.get(zoneId);
    if (zone === undefined || !zone.active) refuse(field, "unavailable");
    if (zone.departmentId !== departmentId) refuse(field, "outside_department");
  };
  for (const zoneId of zoneIds ?? []) check("allowedZoneIds", zoneId);
  check("startingZoneId", startingZoneId);
  if (zoneIds !== null && !zoneIds.includes(startingZoneId)) {
    refuse("startingZoneId", "outside_allowed");
  }
  return { departmentId, zoneIds, startingZoneId };
}
