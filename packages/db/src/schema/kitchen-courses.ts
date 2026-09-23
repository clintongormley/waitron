import { foreignKey, unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A venue-configured KITCHEN COURSE (KDS-2) — "Entrantes", "Principales", "Postres". The coursing
 * SEQUENCE a table's food is fired in: `display_order` IS that order (lowest = first, auto-fired on
 * send), later courses HELD (`ticket_items.fired_at IS NULL`, greyed on the station display) until
 * someone fires them. A product carries a default course (`products.course_id`), resolved onto the
 * line at ring time (`working_order_lines.course_id`) and snapshotted onto the fired item
 * (`ticket_items.course_id`), the same product-default → line → snapshot chain KDS-1's `station_id`
 * uses.
 *
 * Location-scoped, exactly like `kitchen_stations` (KDS-1) and `floor_zones` (FP-1): a course belongs
 * to one venue, so the (location_id) → locations(id) FK ties it to its venue and
 * `kitchen_courses_name_key` makes a name unique within that venue. `products.course_id`,
 * `working_order_lines.course_id` and `ticket_items.course_id` each reference this table's `id`.
 * No default-course
 * concept and no partial unique — unlike `kitchen_stations`, which needs exactly-one-default; a null
 * course simply fires earliest (spec §2b).
 */
export const kitchenCourses = table(
  "kitchen_courses",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Bare column: the FK is the (location_id) →
    // locations(id) declared below (mirroring kitchen_stations_location_fk).
    locationId: id("location_id").notNull(),
    // The human label ("Entrantes", "Principales", "Postres"). Unique within a venue.
    name: label("name").notNull(),
    // THE COURSE SEQUENCE (spec §2a): lowest display_order fires first (auto-fired on send); later
    // courses are held. Author-controlled in the Cursos config editor.
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // No two courses share a name within a venue.
    unique("kitchen_courses_name_key").on(t.locationId, t.name),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_courses_location_fk",
    }),
  ],
);
