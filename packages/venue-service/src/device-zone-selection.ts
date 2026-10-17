import { createHash } from "node:crypto";
import { and, count, eq, isNull } from "drizzle-orm";
import { deviceProfiles, devices, type Transaction } from "@waitron/db";
import type { DeviceZoneSelection, DeviceZoneSelectionInput } from "@waitron/module";
import { AppError, isUuid } from "@waitron/shared";
import { listServiceZones, type VenueScope } from "./operations.js";
import { readProfileServiceScopes, readProfileZones } from "./profile-access.js";
import { deviceZoneSelections, deviceZoneSelectionZones } from "./schema/device-zone-selection.js";
import "./errors.js";

type Field = "profileId" | "snapshot" | "selectedZoneIds" | "startingZoneId";
function invalid(field: Field): never {
  throw new AppError("device_zones.invalid", { field });
}
function uuid(value: unknown, field: Field): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value.toLowerCase();
}

export async function readDeviceZoneSelection(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
): Promise<DeviceZoneSelection> {
  const [profile] = await tx
    .select({
      id: deviceProfiles.id,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
      startingScreen: deviceProfiles.startingScreen,
      retiredAt: deviceProfiles.retiredAt,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(
      and(
        eq(devices.id, deviceId),
        eq(devices.locationId, cfg.locationId),
        isNull(devices.deletedAt),
      ),
    );
  if (profile === undefined) throw new AppError("device.not_found", { deviceId });
  const scope = await readProfileZones(tx, cfg, profile.id);
  const profileScope = await readProfileServiceScopes(tx, [profile.id]);
  const zones = (await listServiceZones(tx, cfg))
    .filter((zone) => scope.allowedZoneIds === null || scope.allowedZoneIds.includes(zone.id))
    .map(({ id, name, serviceMode, departmentId, departmentName }) => ({
      id,
      name,
      serviceMode,
      departmentId,
      departmentName,
    }));
  const [stored] = await tx
    .select()
    .from(deviceZoneSelections)
    .where(
      and(
        eq(deviceZoneSelections.deviceId, deviceId),
        eq(deviceZoneSelections.deviceProfileId, profile.id),
      ),
    );
  const savedIds = (
    await tx
      .select({ id: deviceZoneSelectionZones.zoneId })
      .from(deviceZoneSelectionZones)
      .where(
        and(
          eq(deviceZoneSelectionZones.deviceId, deviceId),
          eq(deviceZoneSelectionZones.deviceProfileId, profile.id),
        ),
      )
  )
    .map((row) => row.id)
    .sort();
  let selectedZoneIds = zones
    .filter((zone) => stored === undefined || savedIds.includes(zone.id))
    .map((zone) => zone.id);
  let adjusted = stored !== undefined && selectedZoneIds.length !== savedIds.length;
  if (stored !== undefined && selectedZoneIds.length === 0 && zones.length > 0) {
    selectedZoneIds = [zones.find((zone) => zone.id === scope.startingZoneId)?.id ?? zones[0]!.id];
    adjusted = true;
  }
  const preferred = stored === undefined ? scope.startingZoneId : stored.startingZoneId;
  const startingZoneId =
    preferred !== null && selectedZoneIds.includes(preferred)
      ? preferred
      : scope.startingZoneId !== null && selectedZoneIds.includes(scope.startingZoneId)
        ? scope.startingZoneId
        : (selectedZoneIds[0] ?? null);
  if (stored !== undefined && startingZoneId !== stored.startingZoneId) adjusted = true;
  const snapshot = createHash("sha256")
    .update(
      JSON.stringify([
        cfg.locationId,
        deviceId,
        profile.id,
        profile.formFactor,
        [...(profile.capabilities as string[])].sort(),
        profile.startingScreen,
        profile.retiredAt,
        profileScope,
        scope,
        zones,
        stored?.startingZoneId ?? null,
        stored !== undefined,
        savedIds,
      ]),
    )
    .digest("hex");
  return { profileId: profile.id, snapshot, zones, selectedZoneIds, startingZoneId, adjusted };
}

export async function setDeviceZoneSelection(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
  input: DeviceZoneSelectionInput,
): Promise<DeviceZoneSelection> {
  const profileId = uuid(input.profileId, "profileId");
  if (typeof input.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshot))
    invalid("snapshot");
  if (!Array.isArray(input.selectedZoneIds) || input.selectedZoneIds.length === 0)
    invalid("selectedZoneIds");
  const ids = input.selectedZoneIds.map((value) => uuid(value, "selectedZoneIds"));
  if (new Set(ids).size !== ids.length) invalid("selectedZoneIds");
  const start = uuid(input.startingZoneId, "startingZoneId");
  const current = await readDeviceZoneSelection(tx, cfg, deviceId);
  if (current.profileId !== profileId || current.snapshot !== input.snapshot)
    throw new AppError("device_zones.changed", {});
  if (ids.some((id) => !current.zones.some((zone) => zone.id === id))) invalid("selectedZoneIds");
  if (!ids.includes(start)) invalid("startingZoneId");
  await tx
    .insert(deviceZoneSelections)
    .values({ deviceId, deviceProfileId: profileId, startingZoneId: start })
    .onConflictDoUpdate({
      target: [deviceZoneSelections.deviceId, deviceZoneSelections.deviceProfileId],
      set: { startingZoneId: start },
    });
  await tx
    .delete(deviceZoneSelectionZones)
    .where(
      and(
        eq(deviceZoneSelectionZones.deviceId, deviceId),
        eq(deviceZoneSelectionZones.deviceProfileId, profileId),
      ),
    );
  await tx
    .insert(deviceZoneSelectionZones)
    .values(ids.map((zoneId) => ({ deviceId, deviceProfileId: profileId, zoneId })));
  return readDeviceZoneSelection(tx, cfg, deviceId);
}

export async function countDeviceZoneSelections(
  tx: Transaction,
  deviceId: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(deviceZoneSelections)
    .where(eq(deviceZoneSelections.deviceId, deviceId));
  return row!.total;
}

export async function removeDeviceZoneSelections(tx: Transaction, deviceId: string): Promise<void> {
  await tx.delete(deviceZoneSelections).where(eq(deviceZoneSelections.deviceId, deviceId));
}
