import { foreignKey, unique } from "drizzle-orm/sqlite-core";
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
 * `categories.station_id` / `products.station_id` / `ticket_items.station_id` carry the (station_id)
 * → kitchen_stations(id) FK, hand-written in the paired --custom migration.
 *
 * "Exactly one default per location" is a PARTIAL unique — `UNIQUE (location_id) WHERE
 * is_default` — which drizzle-kit does not model, so it is hand-written in the --custom migration
 * alongside the app_user grants.
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
    // FORGOTTEN after `forgotten_after_minutes`. The hand-written --custom migration adds the
    // kitchen_stations_thresholds_ordered CHECK (warm < overdue < forgotten) drizzle-kit cannot model.
    warmAfterMinutes: count("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: count("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: count("forgotten_after_minutes").notNull().default(15),
    // The counter/pass fallback station a fired line lands on when neither its product nor its
    // category names one. At most one per location — the partial unique (hand-written) enforces it.
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // No two stations share a name within a venue.
    unique("kitchen_stations_name_key").on(t.locationId, t.name),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_stations_location_fk",
    }),
  ],
);
