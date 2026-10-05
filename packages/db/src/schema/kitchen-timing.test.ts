import { sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations, tenants } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
let locationId: string;
let stationId: string;
beforeAll(async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Timing fixture" });
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Timing venue", invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  locationId = location!.id;
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ locationId, name: "Kitchen" })
    .returning({ id: kitchenStations.id });
  stationId = station!.id;
});

it("stores ordered venue defaults and independent nullable station overrides", async () => {
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`insert into kitchen_timing_defaults (location_id) values (${locationId})`);
    await tx.execute(
      sql`insert into kitchen_station_timing (station_id, overdue_after_minutes) values (${stationId}, 8)`,
    );
    const defaults = await tx.execute(
      sql`select warm_after_minutes as warm, overdue_after_minutes as overdue, forgotten_after_minutes as forgotten from kitchen_timing_defaults where location_id = ${locationId}`,
    );
    expect(defaults.rows).toEqual([{ warm: 5, overdue: 10, forgotten: 15 }]);
    const overrides = await tx.execute(
      sql`select warm_after_minutes as warm, overdue_after_minutes as overdue, forgotten_after_minutes as forgotten from kitchen_station_timing where station_id = ${stationId}`,
    );
    expect(overrides.rows).toEqual([{ warm: null, overdue: 8, forgotten: null }]);
  });
});
