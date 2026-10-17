import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { deviceProfiles, devices, floorZones, id, table } from "@waitron/db";

export const deviceZoneSelections = table(
  "device_zone_selections",
  {
    deviceId: id("device_id").notNull(),
    deviceProfileId: id("device_profile_id").notNull(),
    startingZoneId: id("starting_zone_id"),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.deviceProfileId], name: "device_zone_selections_pk" }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_zone_selections_device_fk",
    }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_zone_selections_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.startingZoneId],
      foreignColumns: [floorZones.id],
      name: "device_zone_selections_start_fk",
    }),
  ],
);

export const deviceZoneSelectionZones = table(
  "device_zone_selection_zones",
  {
    deviceId: id("device_id").notNull(),
    deviceProfileId: id("device_profile_id").notNull(),
    zoneId: id("zone_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceId, t.deviceProfileId, t.zoneId],
      name: "device_zone_selection_zones_pk",
    }),
    foreignKey({
      columns: [t.deviceId, t.deviceProfileId],
      foreignColumns: [deviceZoneSelections.deviceId, deviceZoneSelections.deviceProfileId],
      name: "device_zone_selection_zones_selection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "device_zone_selection_zones_zone_fk",
    }),
  ],
);
