import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";

/** Each device can stand at one station; non-till profiles ignore the saved choice. */
export const deviceMadeHereStations = table(
  "device_made_here_stations",
  {
    deviceId: id("device_id").notNull(),
    stationId: id("station_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId], name: "device_made_here_stations_pk" }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_made_here_stations_device_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "device_made_here_stations_station_fk",
    }),
  ],
);
