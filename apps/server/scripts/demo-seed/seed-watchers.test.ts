import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { kitchenStations, locations, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedWatchers } from "./seed-watchers.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";
import type { SeedLocale } from "./menu.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("seedWatchers", () => {
  it.each([
    ["en", "Pass"],
    ["es", "Pase"],
  ] as const)(
    "seeds one %s pass following only the kitchen and deli in every zone",
    async (locale: SeedLocale, name) => {
      await seedTenant(suite.db);
      const [location] = await suite.db
        .insert(locations)
        .values({
          name: "Demo",
          invoiceLocales: [locale === "en" ? "en-GB" : "es-ES"],
          operationDescription: "Demo",
        })
        .returning({ id: locations.id });
      const locationId = location!.id;
      const [kitchen, bar, upstairsBar, deli] = await suite.db
        .insert(kitchenStations)
        .values([
          { locationId, name: "Kitchen" },
          { locationId, name: "Downstairs bar" },
          { locationId, name: "Upstairs bar" },
          { locationId, name: "Deli counter" },
        ])
        .returning({ id: kitchenStations.id });
      const stationIds = {
        kitchen: kitchen!.id,
        bar: bar!.id,
        upstairsBar: upstairsBar!.id,
        deli: deli!.id,
      };

      const rows = await withTransaction(suite.db, async (tx) => {
        await seedWatchers(tx, { locationId, locale, dataSet: CASA_DELGADO_ES, stationIds });
        const { rows } = await tx.execute<{
          name: string;
          every_station: number;
          every_zone: number;
          runs_pass: number;
          display_order: number;
          active: number;
          station_id: string;
        }>(sql`
        select w.name, w.every_station, w.every_zone, w.runs_pass, w.display_order,
               w.active, ws.station_id
        from watchers w join watcher_stations ws on ws.watcher_id = w.id
        where w.location_id = ${locationId}
        order by ws.station_id`);
        return rows;
      });

      expect(rows).toEqual(
        [stationIds.kitchen, stationIds.deli].sort().map((station_id) => ({
          name,
          every_station: 0,
          every_zone: 1,
          runs_pass: 1,
          display_order: 1,
          active: 1,
          station_id,
        })),
      );
    },
  );
});
