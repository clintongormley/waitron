import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

export const locationCatalogues = pgTable(
  "location_catalogues",
  {
    // Bare column: the (location_id) → locations(id) composite
    // FK is hand-written in the --custom migration.
    locationId: uuid("location_id").notNull(),
    // Bare column: the (catalogue_id) → catalogues(id) composite
    // FK is hand-written in the --custom migration.
    catalogueId: uuid("catalogue_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.locationId, t.catalogueId],
      name: "location_catalogues_pk",
    }),
  ],
);
