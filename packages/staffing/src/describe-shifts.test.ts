import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts } from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { shiftAssignments, staffRoles } from "./schema/staffing.js";
import * as staffing from "./index.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
    STAFFING_MIGRATIONS,
  ],
});
describe("describeShifts", () => {
  it("labels only the requested assigned shifts with their area and staff role, including inactive retained areas", async () => {
    const venue = await seedVenue(suite.db);
    const ids = await withTransaction(suite.db, async (tx) => {
      const [staffRole] = await tx
        .insert(staffRoles)
        .values({ locationId: venue.cfg.locationId, name: "Sous chef" })
        .returning();
      const ids: string[] = [];
      for (const area of [
        { departmentId: venue.departmentId },
        { stationId: venue.stationId },
        null,
        { stationId: venue.stationId },
      ]) {
        const [shift] = await tx
          .insert(shifts)
          .values({
            personId: venue.ana,
            locationId: venue.cfg.locationId,
            startsAt: "2026-01-05T09:00:00Z",
            startsOffsetMinutes: 0,
            endsAt: "2026-01-05T17:00:00Z",
            endsOffsetMinutes: 0,
          })
          .returning();
        ids.push(shift!.id);
        if (area)
          await tx
            .insert(shiftAssignments)
            .values({ shiftId: shift!.id, staffRoleId: staffRole!.id, ...area });
      }
      return ids;
    });
    const read = (ids: readonly string[]) =>
      withTransaction(suite.db, (tx) => staffing.describeShifts(tx, ids));
    expect(await read([])).toEqual(new Map());
    expect(await read(ids.slice(0, 3))).toEqual(
      new Map([
        [ids[0], "Dining room · Sous chef"],
        [ids[1], "Grill · Sous chef"],
      ]),
    );
    await suite.db.execute(
      sql`update departments set active=0, name='Retired room' where id=${venue.departmentId}`,
    );
    expect(await read([ids[0]!])).toEqual(new Map([[ids[0], "Retired room · Sous chef"]]));
    expect(await read([crypto.randomUUID()])).toEqual(new Map());
  });
});
