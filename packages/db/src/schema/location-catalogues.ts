import { primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { catalogues } from "./catalogue.js";
import { locations } from "./tenants.js";

export const locationCatalogues = table(
  "location_catalogues",
  {
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id),
    /* v8 ignore stop */
    catalogueId: id("catalogue_id")
      .notNull()
      /* v8 ignore start */
      .references(() => catalogues.id),
    /* v8 ignore stop */
  },
  (t) => [
    primaryKey({
      columns: [t.locationId, t.catalogueId],
      name: "location_catalogues_pk",
    }),
  ],
);
