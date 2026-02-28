import { pgTable, uuid, primaryKey } from "drizzle-orm/pg-core";
import { menuItems } from "./menu-items";
import { kitchenStations } from "./kitchen-stations";

export const menuItemStations = pgTable(
  "menu_item_stations",
  {
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    stationId: uuid("station_id")
      .notNull()
      .references(() => kitchenStations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.menuItemId, t.stationId] })],
);
