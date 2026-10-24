import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { kitchenStations } from "./kitchen-stations.js";
import { orderGroups } from "./order-groups.js";

/**
 * The stations that have a held group's HOLD paper: corrections, MOVED slips and reprints of its
 * held work print only at them, and its release is marked FIRE on their tickets.
 */
export const orderGroupHoldStations = table(
  "order_group_hold_stations",
  {
    groupId: id("group_id").notNull(),
    stationId: id("station_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.stationId], name: "order_group_hold_stations_pk" }),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [orderGroups.id],
      name: "order_group_hold_stations_group_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "order_group_hold_stations_station_fk",
    }),
  ],
);
