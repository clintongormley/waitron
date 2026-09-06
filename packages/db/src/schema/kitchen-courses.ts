import {
  boolean,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

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
 * to one venue, so the composite (tenant_id, location_id) → locations(tenant_id, id) FK ties it to its
 * venue and `kitchen_courses_name_key` makes a name unique within that venue. `products.course_id` /
 * `working_order_lines.course_id` / `ticket_items.course_id` carry the tenant-consistent
 * (tenant_id, course_id) → kitchen_courses(tenant_id, id) FK, hand-written in the paired --custom
 * migration (the `kitchen_courses_tenant_id_key` UNIQUE below is that FK's target). No default-course
 * concept and no partial unique — unlike `kitchen_stations`, which needs exactly-one-default; a null
 * course simply fires earliest (spec §2b).
 */
export const kitchenCourses = pgTable(
  "kitchen_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason floor-zones.ts / orders.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, location_id) →
    // locations(tenant_id, id) declared below (mirroring kitchen_stations_location_fk).
    locationId: uuid("location_id").notNull(),
    // The human label ("Entrantes", "Principales", "Postres"). Unique within a venue.
    name: text("name").notNull(),
    // THE COURSE SEQUENCE (spec §2a): lowest display_order fires first (auto-fired on send); later
    // courses are held. Author-controlled in the Cursos config editor.
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for the tenant-consistent (tenant_id, course_id)
    // FKs on products/working_order_lines/ticket_items (hand-written --custom migration), the same
    // role kitchen_stations_tenant_id_key plays for the station FKs.
    unique("kitchen_courses_tenant_id_key").on(t.tenantId, t.id),
    // No two courses share a name within a venue.
    unique("kitchen_courses_name_key").on(t.tenantId, t.locationId, t.name),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "kitchen_courses_location_fk",
    }),
  ],
);
