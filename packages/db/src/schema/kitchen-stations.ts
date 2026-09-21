import { sql } from "drizzle-orm";
import { check, foreignKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A venue-configured KITCHEN STATION (KDS-1) — "Cocina", "Plancha", "Barra". The routing target a
 * fired line resolves to, and the per-station display groups its ticket items under. One station per
 * venue is the DEFAULT (`is_default`): the counter/pass fallback that lines with no product- or
 * category-level route land on, and the home of #63's counter prep-queue after the ticket rework.
 *
 * Location-scoped, exactly like `floor_zones` (FP-1) and unlike the venue-wide
 * `table_service_statuses`: a station belongs to one venue, so the (location_id) → locations(id) FK
 * ties it to its venue and `kitchen_stations_name_key` makes a name unique within that venue.
 * `categories.station_id`, `products.station_id`, `devices.station_id`,
 * `station_printers.station_id` and `ticket_items.station_id` each reference this table's `id`.
 *
 * "Exactly one default per location" is the PARTIAL unique `kitchen_stations_default_key` below —
 * `UNIQUE (location_id) WHERE is_default`.
 */
export const kitchenStations = table(
  "kitchen_stations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Bare column: the FK is the (location_id) →
    // locations(id) declared below (mirroring floor_zones_location_fk).
    locationId: id("location_id").notNull(),
    // The human label ("Cocina", "Plancha", "Barra"). Unique within a venue.
    name: label("name").notNull(),
    // Author-controlled ordering in the config editor + the station picker.
    displayOrder: count("display_order").notNull().default(0),
    // Per-station order-age bands (minutes) for the KDS timing alerts (KDS order-timing-alerts): a
    // fired order goes WARM after `warm_after_minutes`, OVERDUE after `overdue_after_minutes`, and
    // FORGOTTEN after `forgotten_after_minutes`. The bands must be in that order, which is the
    // `kitchen_stations_thresholds_ordered` check below.
    warmAfterMinutes: count("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: count("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: count("forgotten_after_minutes").notNull().default(15),
    // The counter/pass fallback station a fired line lands on when neither its product nor its
    // category names one. At most one per location — the partial unique below enforces it.
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // No two stations share a name within a venue.
    unique("kitchen_stations_name_key").on(t.locationId, t.name),
    // At most one default station per venue. Partial, so the non-default rows are unconstrained.
    // The index keeps the name it was created under.
    uniqueIndex("kitchen_stations_default_key")
      .on(t.locationId)
      .where(sql`${t.isDefault}`),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_stations_location_fk",
    }),
    // The three age bands are strictly increasing: warm before overdue before forgotten.
    check(
      "kitchen_stations_thresholds_ordered",
      sql`${t.warmAfterMinutes} < ${t.overdueAfterMinutes} and ${t.overdueAfterMinutes} < ${t.forgottenAfterMinutes}`,
    ),
  ],
);
