import { foreignKey, unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A kitchen course. `display_order` is the firing sequence. On a counter order or a bill with no
 * party, the order's earliest course fires on send and later ones are held until fired; a line with
 * no course fires earliest. For a seated party the till groups each round by course in this order.
 */
export const kitchenCourses = table(
  "kitchen_courses",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("kitchen_courses_name_key").on(t.locationId, t.name),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_courses_location_fk",
    }),
  ],
);
