import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorTodayTables } from "./schema/floor-plans.js";
import { floorZones } from "./schema/floor-zones.js";
import { locations } from "./schema/tenants.js";
import { tableInService } from "./table-in-service.js";
import { seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const ZONE = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_ZONE = "bbbbbbbb-0000-4000-8000-000000000002";
const PRESENT = "cccccccc-0000-4000-8000-000000000001";
const TAKEN_OFF = "cccccccc-0000-4000-8000-000000000002";
const ABSENT = "cccccccc-0000-4000-8000-000000000003";
const DISABLED_ZONE = "cccccccc-0000-4000-8000-000000000004";

describe("table in service", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(floorZones).values([
      { id: ZONE, locationId: LOCATION, name: "On" },
      { id: OTHER_ZONE, locationId: LOCATION, name: "Off", active: false },
    ]);
    await suite.db.insert(diningTables).values([
      { id: PRESENT, locationId: LOCATION, zoneId: ZONE, label: "Present", active: false },
      { id: TAKEN_OFF, locationId: LOCATION, zoneId: ZONE, label: "Taken off" },
      { id: ABSENT, locationId: LOCATION, zoneId: ZONE, label: "Absent" },
      { id: DISABLED_ZONE, locationId: LOCATION, zoneId: OTHER_ZONE, label: "Disabled zone" },
    ]);
    await suite.db
      .insert(floorTodayTables)
      .values([
        { tableId: PRESENT },
        { tableId: TAKEN_OFF, takenOff: true },
        { tableId: DISABLED_ZONE },
      ]);
  });

  async function read() {
    return suite.db
      .select({ id: diningTables.id, inService: tableInService(diningTables.id) })
      .from(diningTables)
      .orderBy(diningTables.id);
  }

  it("calls a table with a today's row in a switched-on zone in service, a taken-off one too", async () => {
    const rows = await read();
    expect(rows.slice(0, 2)).toEqual([
      { id: PRESENT, inService: 1 },
      { id: TAKEN_OFF, inService: 1 },
    ]);
  });

  it("calls a table with no today's row out of service, though active is true", async () => {
    expect((await read())[2]).toEqual({ id: ABSENT, inService: 0 });
  });

  it("calls a table out of service while its zone is switched off, and in again when it is on", async () => {
    expect((await read())[3]).toEqual({ id: DISABLED_ZONE, inService: 0 });
    await suite.db.update(floorZones).set({ active: true }).where(eq(floorZones.id, OTHER_ZONE));
    expect((await read())[3]).toEqual({ id: DISABLED_ZONE, inService: 1 });
  });

  it("is usable in a raw select as a column", async () => {
    const rows = await suite.db.all(
      sql`select dt.id, ${tableInService(sql`dt.id`)} as in_service from dining_tables dt order by dt.id`,
    );
    expect(rows).toEqual([
      { id: PRESENT, in_service: 1 },
      { id: TAKEN_OFF, in_service: 1 },
      { id: ABSENT, in_service: 0 },
      { id: DISABLED_ZONE, in_service: 0 },
    ]);
  });

  it("keeps the same table correlation when the table is joined", async () => {
    const rows = await suite.db
      .select({ id: diningTables.id, inService: tableInService(diningTables.id) })
      .from(locations)
      .innerJoin(diningTables, eq(diningTables.locationId, locations.id))
      .orderBy(diningTables.id);
    expect(rows).toEqual([
      { id: PRESENT, inService: 1 },
      { id: TAKEN_OFF, inService: 1 },
      { id: ABSENT, inService: 0 },
      { id: DISABLED_ZONE, inService: 0 },
    ]);
  });
});
