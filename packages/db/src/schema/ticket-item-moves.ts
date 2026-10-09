import { foreignKey, index } from "drizzle-orm/sqlite-core";
import { id, newId, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrderLines } from "./orders.js";

/** One hand move of a dish to another station, kept with the order line because a changed dish's
 * ticket item is replaced while the move still stands. */
export const ticketItemMoves = table(
  "ticket_item_moves",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderLineId: id("working_order_line_id").notNull(),
    fromStationId: id("from_station_id").notNull(),
    toStationId: id("to_station_id").notNull(),
    movedAt: tsString("moved_at").notNull(),
    movedByDeviceId: id("moved_by_device_id").notNull(),
    // People live in identity's migration set, which core cannot reference.
    movedByPersonId: id("moved_by_person_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderLineId],
      foreignColumns: [workingOrderLines.id],
      name: "ticket_item_moves_line_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.fromStationId],
      foreignColumns: [kitchenStations.id],
      name: "ticket_item_moves_from_station_fk",
    }),
    foreignKey({
      columns: [t.toStationId],
      foreignColumns: [kitchenStations.id],
      name: "ticket_item_moves_to_station_fk",
    }),
    foreignKey({
      columns: [t.movedByDeviceId],
      foreignColumns: [devices.id],
      name: "ticket_item_moves_device_fk",
    }),
    index("ticket_item_moves_line_idx").on(t.workingOrderLineId),
  ],
);
