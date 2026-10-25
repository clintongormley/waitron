import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorZones } from "./schema/floor-zones.js";
import { locations, tenants } from "./schema/tenants.js";
import { shortNameColumns, storeTableShortNameKeys } from "./table-short-names.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("shortNameColumns", () => {
  it("writes the folded key beside the short name, and nulls for none", () => {
    expect(shortNameColumns("TÉ1")).toEqual({ shortName: "TÉ1", shortNameKey: "té1" });
    expect(shortNameColumns(null)).toEqual({ shortName: null, shortNameKey: null });
  });
});

describe("storeTableShortNameKeys", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";

  it("sets each table's key from its short name, folding beyond ASCII, and leaves none for none", async () => {
    const ids = await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" });
      await tx.insert(locations).values({
        id: LOCATION,
        name: "Loc",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      });
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: LOCATION, name: "Zone" })
        .returning({ id: floorZones.id });
      const insert = async (label: string, shortName: string | null) => {
        const [row] = await tx
          .insert(diningTables)
          .values({ locationId: LOCATION, label, zoneId: zone!.id, shortName })
          .returning({ id: diningTables.id });
        return row!.id;
      };
      return { named: await insert("Terrace 1", "TÉ1"), unnamed: await insert("Bar 1", null) };
    });
    await withTransaction(suite.db, storeTableShortNameKeys);
    const key = async (id: string) =>
      (
        await suite.db
          .select({ shortNameKey: diningTables.shortNameKey })
          .from(diningTables)
          .where(eq(diningTables.id, id))
      )[0]!.shortNameKey;
    expect(await key(ids.named)).toBe("té1");
    expect(await key(ids.unnamed)).toBeNull();
  });
});
