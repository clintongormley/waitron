import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorZones } from "./schema/floor-zones.js";
import {
  SHORT_NAME_KEY_BATCH,
  shortNameColumns,
  storeTableShortNameKeys,
} from "./table-short-names.js";
import { withTransaction } from "./tenancy.js";
import { seedVenue } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { venueLocationId } from "./venue.js";

describe("shortNameColumns", () => {
  it("writes the folded key beside the short name, and nulls for none", () => {
    expect(shortNameColumns("TÉ1")).toEqual({ shortName: "TÉ1", shortNameKey: "té1" });
    expect(shortNameColumns(null)).toEqual({ shortName: null, shortNameKey: null });
  });
});

describe("storeTableShortNameKeys", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  async function insertTables(rows: readonly { label: string; shortName: string | null }[]) {
    return withTransaction(suite.db, async (tx) => {
      await seedVenue(tx, {
        name: "Loc",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      });
      const LOCATION = await venueLocationId(tx);
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: LOCATION, name: "Zone" })
        .returning({ id: floorZones.id });
      const ids: string[] = [];
      for (const { label, shortName } of rows) {
        const [row] = await tx
          .insert(diningTables)
          .values({ locationId: LOCATION, label, zoneId: zone!.id, shortName })
          .returning({ id: diningTables.id });
        ids.push(row!.id);
      }
      return ids;
    });
  }

  const key = async (id: string) =>
    (
      await suite.db
        .select({ shortNameKey: diningTables.shortNameKey })
        .from(diningTables)
        .where(eq(diningTables.id, id))
    )[0]!.shortNameKey;

  it("sets each table's key from its short name, folding beyond ASCII, and leaves none for none", async () => {
    const [named, unnamed] = await insertTables([
      { label: "Terrace 1", shortName: "TÉ1" },
      { label: "Bar 1", shortName: null },
    ]);
    await withTransaction(suite.db, storeTableShortNameKeys);
    expect(await key(named!)).toBe("té1");
    expect(await key(unnamed!)).toBeNull();
  });

  it("sets the keys of tables past the first batch", async () => {
    const ids = await insertTables(
      Array.from({ length: SHORT_NAME_KEY_BATCH + 1 }, (_, i) => ({
        label: `Table ${i}`,
        shortName: `T${i}`,
      })),
    );
    await withTransaction(suite.db, storeTableShortNameKeys);
    expect(await key(ids[0]!)).toBe("t0");
    expect(await key(ids[SHORT_NAME_KEY_BATCH]!)).toBe(`t${SHORT_NAME_KEY_BATCH}`);
  });
});
