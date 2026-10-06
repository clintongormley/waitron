import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { deviceProfiles, floorZones, kitchenStations, watchers } from "@waitron/db";
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
 * department restriction (and, for a shared display, no ordering): `allowedZoneIds` and
 * `startingZoneId` are then null too. With a department, `allowedZoneIds` lists the zones the
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

function refuse(field: Refusal["field"], reason: Refusal["reason"]): never {
  throw new AppError("device_profile.access_invalid", { field, reason });
}

export async function readProfileServiceAccess(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
): Promise<ProfileServiceAccess> {
  const [profile] = await tx
    .select({
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

  if (profile.departmentId === null || profile.startingZoneId === null) {
    return {
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
      stationIds,
      watcherIds,
    };
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
    stationIds,
    watcherIds,
  };
}

/** Replaces the profile's whole service scope, after checking every id against the venue's rows. */
export async function setProfileServiceAccess(
  tx: Transaction,
  cfg: VenueScope,
  profileId: string,
  input: ProfileServiceAccessInput,
): Promise<void> {
  const [profile] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.id, profileId), isNull(deviceProfiles.retiredAt)));
  if (profile === undefined) refuse("profileId", "not_found");

  const scope = await checkedScope(tx, cfg, input);
  const stationIds = [...new Set(input.stationIds)];
  const watcherIds = [...new Set(input.watcherIds)];
  if (stationIds.length > 0) {
    const found = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(
        and(
          inArray(kitchenStations.id, stationIds),
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.active, true),
        ),
      );
    if (found.length !== stationIds.length) refuse("stationIds", "not_found");
  }
  if (watcherIds.length > 0) {
    const found = await tx
      .select({ id: watchers.id })
      .from(watchers)
      .where(
        and(
          inArray(watchers.id, watcherIds),
          eq(watchers.locationId, cfg.locationId),
          eq(watchers.active, true),
        ),
      );
    if (found.length !== watcherIds.length) refuse("watcherIds", "not_found");
  }

  // Deleting the scope row also deletes its `device_profile_zones` rows, through their key.
  await tx
    .delete(deviceProfileServiceAccess)
    .where(eq(deviceProfileServiceAccess.deviceProfileId, profileId));
  if (scope !== null) {
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
  input: ProfileServiceAccessInput,
): Promise<{ departmentId: string; zoneIds: string[] | null; startingZoneId: string } | null> {
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
