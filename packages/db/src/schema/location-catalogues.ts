import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The location → catalogue accessibility map: the OTHER catalogues (menus) a location may sell,
 * beyond its default `locations.catalogue_id`. A many-to-many join keyed on identity —
 * PRIMARY KEY (tenant_id, location_id, catalogue_id); a (location, catalogue) pair is present at
 * most once and attach/detach is add/remove of exactly that row. `location_id`/`catalogue_id` are
 * BARE uuids: their tenant-consistent composite FKs — (tenant_id, location_id) → locations
 * (tenant_id, id) and (tenant_id, catalogue_id) → catalogues(tenant_id, id) — are hand-written in
 * the paired --custom migration, exactly as station_printers does. `.enableRLS()` emits only ENABLE;
 * the FORCE, the location_catalogues_tenant_isolation policy and the SELECT/INSERT/DELETE grant are
 * hand-written there too (the inmutabilidad scan requires FORCE on every tenant_id table).
 */
export const locationCatalogues = pgTable(
  "location_catalogues",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason the sibling schema files use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the tenant-consistent (tenant_id, location_id) → locations(tenant_id, id) composite
    // FK is hand-written in the --custom migration.
    locationId: uuid("location_id").notNull(),
    // Bare column: the tenant-consistent (tenant_id, catalogue_id) → catalogues(tenant_id, id) composite
    // FK is hand-written in the --custom migration.
    catalogueId: uuid("catalogue_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.locationId, t.catalogueId],
      name: "location_catalogues_pk",
    }),
  ],
).enableRLS();
