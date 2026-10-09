import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import {
  deviceProfiles,
  devices,
  enumCheck,
  enumType,
  flag,
  floorZones,
  id,
  kitchenStations,
  newId,
  nowIso,
  table,
  tsString,
} from "@waitron/db";

export const KITCHEN_SCREEN_KINDS = ["station", "pass", "pass_monitor"] as const;
const kitchenScreenKind = enumType(KITCHEN_SCREEN_KINDS);

/**
 * A kitchen screen a profile bounds (till, handheld) or offers (kds). Which kinds a form factor may
 * hold is checked by `setProfileKitchenScreens`, not here. `every_station` / `every_zone` false
 * means the explicit list in the two tables below.
 */
export const deviceProfileKitchenScreens = table(
  "device_profile_kitchen_screens",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    everyStation: flag("every_station").notNull().default(false),
    everyZone: flag("every_zone").notNull().default(false),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId, t.screen],
      name: "device_profile_kitchen_screens_pk",
    }),
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

/**
 * The kitchen screen a device chose, within its profile's. "One per kitchen display" is checked by
 * `setDeviceKitchenScreens`. The device key is `no action`, not `cascade`, so a rebuild of
 * `devices` refuses instead of silently emptying every device's choice.
 */
export const deviceKitchenScreens = table(
  "device_kitchen_screens",
  {
    deviceId: id("device_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    everyStation: flag("every_station").notNull().default(false),
    everyZone: flag("every_zone").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.screen], name: "device_kitchen_screens_pk" }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_kitchen_screens_device_fk",
    }),
    check("device_kitchen_screens_screen_ck", enumCheck(t.screen)),
    check(
      "device_kitchen_screens_station_zones_ck",
      sql`${t.screen} <> 'station' or ${t.everyZone} = 0`,
    ),
  ],
);

export const deviceKitchenScreenStations = table(
  "device_kitchen_screen_stations",
  {
    deviceId: id("device_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    stationId: id("station_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceId, t.screen, t.stationId],
      name: "device_kitchen_screen_stations_pk",
    }),
    foreignKey({
      columns: [t.deviceId, t.screen],
      foreignColumns: [deviceKitchenScreens.deviceId, deviceKitchenScreens.screen],
      name: "device_kitchen_screen_stations_screen_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "device_kitchen_screen_stations_station_fk",
    }),
    check("device_kitchen_screen_stations_screen_ck", enumCheck(t.screen)),
  ],
);

export const deviceKitchenScreenZones = table(
  "device_kitchen_screen_zones",
  {
    deviceId: id("device_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    zoneId: id("zone_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceId, t.screen, t.zoneId],
      name: "device_kitchen_screen_zones_pk",
    }),
    foreignKey({
      columns: [t.deviceId, t.screen],
      foreignColumns: [deviceKitchenScreens.deviceId, deviceKitchenScreens.screen],
      name: "device_kitchen_screen_zones_screen_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "device_kitchen_screen_zones_zone_fk",
    }),
    check("device_kitchen_screen_zones_screen_ck", enumCheck(t.screen)),
    check("device_kitchen_screen_zones_not_station_ck", sql`${t.screen} <> 'station'`),
  ],
);

/**
 * What a profile narrowing took from a device: a station, a zone, or (neither set) the kind itself.
 * Keyed to the device rather than its kitchen screen row, because the narrowing may delete that row
 * and the removal must outlive it. No unique index: it would have to be an expression over the
 * nullable columns, so the writer inserts only what is not already recorded.
 */
export const deviceKitchenScreenRemovals = table(
  "device_kitchen_screen_removals",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    deviceId: id("device_id").notNull(),
    screen: kitchenScreenKind("screen").notNull(),
    stationId: id("station_id"),
    zoneId: id("zone_id"),
    removedAt: tsString("removed_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("device_kitchen_screen_removals_device_idx").on(t.deviceId),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_kitchen_screen_removals_device_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "device_kitchen_screen_removals_station_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "device_kitchen_screen_removals_zone_fk",
    }),
    check("device_kitchen_screen_removals_screen_ck", enumCheck(t.screen)),
    check(
      "device_kitchen_screen_removals_one_target_ck",
      sql`${t.stationId} is null or ${t.zoneId} is null`,
    ),
  ],
);
