import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { diningTables, floorZones, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createTable } from "./live-table.js";
import { setupPartyVenue } from "./party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("test live tables", () => {
  it("makes a table for a zone whose service policy the fixture has not installed yet", async () => {
    const v = await setupPartyVenue(suite.db);
    const result = await withTransaction(suite.db, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({
          locationId: v.cfg.locationId,
          name: "Fixture zone",
        })
        .returning({ id: floorZones.id });
      const { id } = await createTable(tx, v.cfg, {
        label: "Fixture table",
        zoneId: zone!.id,
        capacity: 6,
      });
      const [row] = await tx.select().from(diningTables).where(eq(diningTables.id, id));
      return { row, zoneId: zone!.id };
    });
    expect(result.row).toMatchObject({
      locationId: v.cfg.locationId,
      label: "Fixture table",
      zoneId: result.zoneId,
      capacity: 6,
      active: true,
    });
  });
});
