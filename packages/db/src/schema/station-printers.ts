import { primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";

/**
 * The KDS station → printer MAPPING (KDS-4 §2a, "Slice B" of kitchen printing). A many-to-many join:
 * a station has zero-or-more printers (a screen-less prep station gets paper; a group printer is
 * attached to every station), and a printer serves one-or-more stations. When a station's items fire
 * (KDS-1's fire point), a ticket prints at each printer attached to that station.
 *
 * NOT location-scoped: the station (KDS-1) and the printer (Slice A) each already carry the
 * location, so the mapping needs only the two ids. The key is the identity —
 * PRIMARY KEY (station_id, printer_id), no surrogate id — because a (station, printer) pair
 * is present at most once and attach/detach is add/remove of exactly that row.
 */
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
