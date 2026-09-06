import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

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
);
