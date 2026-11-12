import { primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";

export const stationPrinters = table(
  "station_printers",
  {
    stationId: id("station_id")
      .notNull()
      /* v8 ignore start */
      .references(() => kitchenStations.id),
    /* v8 ignore stop */
    printerId: id("printer_id")
      .notNull()
      /* v8 ignore start */
      .references(() => printers.id),
    /* v8 ignore stop */
  },
  (t) => [
    primaryKey({
      columns: [t.stationId, t.printerId],
      name: "station_printers_pk",
    }),
  ],
);
