import { sql } from "drizzle-orm";
import { foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A kitchen course. `display_order` is the firing sequence. On a counter order or a bill with no
 * party, the order's earliest course fires on send and later ones are held until fired; a line with
 * no course fires earliest. `held_until_fired` places a table's new line in a held group; courses
 * that are not held, and lines without a course, go to Fire now.
 */
export const kitchenCourses = table(
  "kitchen_courses",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    heldUntilFired: flag("held_until_fired").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("kitchen_courses_name_key")
      .on(t.locationId, t.name)
      .where(sql`${t.active} = 1`),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_courses_location_fk",
    }),
  ],
);
