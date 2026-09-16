import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

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
export const stationPrinters = pgTable(
  "station_printers",
  {
    // Bare column: the (station_id) → kitchen_stations(id)
    // FK is hand-written in the --custom migration.
    stationId: uuid("station_id").notNull(),
    // Bare column: the (printer_id) → printers(id) FK
    // is hand-written in the --custom migration.
    printerId: uuid("printer_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.stationId, t.printerId],
      name: "station_printers_pk",
    }),
  ],
);
