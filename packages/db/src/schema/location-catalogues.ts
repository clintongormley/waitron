import { primaryKey } from "drizzle-orm/pg-core";
import { id, table } from "./columns.js";

export const locationCatalogues = table(
  "location_catalogues",
  {
    // Bare column: the (location_id) → locations(id)
    // FK is hand-written in the --custom migration.
    locationId: id("location_id").notNull(),
    // Bare column: the (catalogue_id) → catalogues(id)
    // FK is hand-written in the --custom migration.
    catalogueId: id("catalogue_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.locationId, t.catalogueId],
      name: "location_catalogues_pk",
    }),
  ],
);
