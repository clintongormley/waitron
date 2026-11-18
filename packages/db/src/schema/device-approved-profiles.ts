import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, json, jsonShapeCheck, table } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { floorZones } from "./floor-zones.js";

export const deviceApprovedProfiles = table(
  "device_approved_profiles",
  {
    deviceId: id("device_id").notNull(),
    deviceProfileId: id("device_profile_id").notNull(),
    startingZoneId: id("starting_zone_id"),
    // A saved list can be empty after a zone is deleted. Null means no choice was saved.
    zoneIds: json<string[]>("zone_ids"),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceId, t.deviceProfileId],
      name: "device_approved_profiles_pk",
    }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_approved_profiles_device_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_approved_profiles_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.startingZoneId],
      foreignColumns: [floorZones.id],
      name: "device_approved_profiles_start_fk",
    }),
    check(
      "device_approved_profiles_start_ck",
      sql`${t.startingZoneId} is null or ${t.zoneIds} is not null`,
    ),
    check("device_approved_profiles_zone_ids_ck", jsonShapeCheck(t.zoneIds, "array")),
  ],
);
