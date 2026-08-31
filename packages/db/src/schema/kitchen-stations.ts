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
 * A venue-configured KITCHEN STATION (KDS-1) — "Cocina", "Plancha", "Barra". The routing target a
 * fired line resolves to, and the per-station display groups its ticket items under. One station per
 * venue is the DEFAULT (`is_default`): the counter/pass fallback that lines with no product- or
 * category-level route land on, and the home of #63's counter prep-queue after the ticket rework.
 *
 * Location-scoped, exactly like `floor_zones` (FP-1) and unlike TS-2's tenant-wide
 * `table_service_statuses`: a station belongs to one venue, so the composite (tenant_id, location_id)
 * → locations(tenant_id, id) FK ties it to its venue and `kitchen_stations_name_key` makes a name
 * unique within that venue. `categories.station_id` / `products.station_id` / `ticket_items.station_id`
 * carry the tenant-consistent (tenant_id, station_id) → kitchen_stations(tenant_id, id) FK, hand-written
 * in the paired --custom migration (the `kitchen_stations_tenant_id_key` UNIQUE below is that FK's target).
 *
 * "Exactly one default per location" is a PARTIAL unique — `UNIQUE (tenant_id, location_id) WHERE
 * is_default` — which drizzle-kit does not model, so it is hand-written in the --custom migration
 * alongside FORCE/policy/grants (the deletion-proof target of kitchen-stations.rls.test.ts).
 *
 * Deactivate, never hard-delete (`active`): a `ticket_items.station_id` snapshot may reference a row,
 * so the config CRUD flips `active = false` rather than DELETE — and `app_user` holds no DELETE here
 * (the custom migration grants only SELECT/INSERT/UPDATE). `.enableRLS()` emits only ENABLE ROW LEVEL
 * SECURITY; the FORCE ROW LEVEL SECURITY, the `kitchen_stations_tenant_isolation` policy and the grant
 * are hand-written in the paired --custom migration, exactly as 0052 does for `floor_zones` and 0036
 * for `till_layouts`. The `inmutabilidad` guard in packages/fiscal-verifactu scans every
 * tenant_id-bearing table for both RLS flags, so a missing FORCE here fails that suite.
 */
export const kitchenStations = pgTable(
  "kitchen_stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason floor-zones.ts / orders.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, location_id) →
    // locations(tenant_id, id) declared below (mirroring floor_zones_location_fk).
    locationId: uuid("location_id").notNull(),
    // The human label ("Cocina", "Plancha", "Barra"). Unique within a venue.
    name: text("name").notNull(),
    // Author-controlled ordering in the config editor + the station picker.
    displayOrder: integer("display_order").notNull().default(0),
    // Per-station order-age bands (minutes) for the KDS timing alerts (KDS order-timing-alerts): a
    // fired order goes WARM after `warm_after_minutes`, OVERDUE after `overdue_after_minutes`, and
    // FORGOTTEN after `forgotten_after_minutes`. The hand-written --custom migration adds the
    // kitchen_stations_thresholds_ordered CHECK (warm < overdue < forgotten) drizzle-kit cannot model.
    warmAfterMinutes: integer("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: integer("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: integer("forgotten_after_minutes").notNull().default(15),
    // The counter/pass fallback station a fired line lands on when neither its product nor its
    // category names one. At most one per location — the partial unique (hand-written) enforces it.
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for the tenant-consistent (tenant_id, station_id)
    // FKs on categories/products/ticket_items (hand-written --custom migration), the same role
    // floor_zones_tenant_id_key plays for dining_tables_zone_fk.
    unique("kitchen_stations_tenant_id_key").on(t.tenantId, t.id),
    // No two stations share a name within a venue.
    unique("kitchen_stations_name_key").on(t.tenantId, t.locationId, t.name),
    // Tenant-consistent composite FK to the owning location: a station cannot point at a location of
    // another tenant, independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "kitchen_stations_location_fk",
    }),
  ],
).enableRLS();
