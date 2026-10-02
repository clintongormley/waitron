import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";

/** The stations whose items a device makes on the spot when it sends them (design §5.11). */
export const deviceMadeHereStations = table(
  "device_made_here_stations",
  {
    deviceId: id("device_id").notNull(),
    stationId: id("station_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.stationId], name: "device_made_here_stations_pk" }),
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
