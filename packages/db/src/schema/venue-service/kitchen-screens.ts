import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, flag, id, table } from "../columns.js";
import { deviceProfiles } from "../device-profiles.js";
import { floorZones } from "../floor-zones.js";
import { kitchenStations } from "../kitchen-stations.js";

export const KITCHEN_SCREEN_KINDS = ["station", "pass", "pass_monitor"] as const;
const kitchenScreenKind = enumType(KITCHEN_SCREEN_KINDS);

export const deviceProfileKitchenScreens = table(
  "device_profile_kitchen_screens",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    everyStation: flag("every_station").notNull().default(false),
    everyZone: flag("every_zone").notNull().default(false),
    /** Read only on `pass` and `pass_monitor` rows. */
    showNonPassStations: flag("show_non_pass_stations").notNull().default(true),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId],
      name: "device_profile_kitchen_screens_pk",
    }),
    uniqueIndex("device_profile_kitchen_screens_kind_key").on(t.deviceProfileId, t.screen),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_kitchen_screens_profile_fk",
    }).onDelete("cascade"),
    check("device_profile_kitchen_screens_screen_ck", enumCheck(t.screen)),
    check(
      "device_profile_kitchen_screens_station_zones_ck",
      sql`${t.screen} <> 'station' or ${t.everyZone} = 0`,
    ),
  ],
);

export const deviceProfileKitchenScreenStations = table(
  "device_profile_kitchen_screen_stations",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    stationId: id("station_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId, t.screen, t.stationId],
      name: "device_profile_kitchen_screen_stations_pk",
    }),
    foreignKey({
      columns: [t.deviceProfileId, t.screen],
      foreignColumns: [
        deviceProfileKitchenScreens.deviceProfileId,
        deviceProfileKitchenScreens.screen,
      ],
      name: "device_profile_kitchen_screen_stations_screen_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "device_profile_kitchen_screen_stations_station_fk",
    }),
    check("device_profile_kitchen_screen_stations_screen_ck", enumCheck(t.screen)),
  ],
);

export const deviceProfileKitchenScreenZones = table(
  "device_profile_kitchen_screen_zones",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    zoneId: id("zone_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId, t.screen, t.zoneId],
      name: "device_profile_kitchen_screen_zones_pk",
    }),
    foreignKey({
      columns: [t.deviceProfileId, t.screen],
      foreignColumns: [
        deviceProfileKitchenScreens.deviceProfileId,
        deviceProfileKitchenScreens.screen,
      ],
      name: "device_profile_kitchen_screen_zones_screen_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "device_profile_kitchen_screen_zones_zone_fk",
    }),
    check("device_profile_kitchen_screen_zones_screen_ck", enumCheck(t.screen)),
    check("device_profile_kitchen_screen_zones_not_station_ck", sql`${t.screen} <> 'station'`),
  ],
);
