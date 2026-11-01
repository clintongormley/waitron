import { describe, expect, it } from "vitest";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { catalogues } from "./schema/catalogue.js";
import { locationDayCutoverChanges } from "./schema/business-day-clock.js";
import { locations } from "./schema/tenants.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";
import { readVenue, readVenueClock, readVenueClockAndPlace, venueLocationId } from "./venue.js";

describe("the venue accessor", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  async function insertVenue(values: Partial<typeof locations.$inferInsert> = {}) {
    const [row] = await suite.db
      .insert(locations)
      .values({
        name: "Casa Pepe",
        invoiceLocales: ["es"],
        operationDescription: "Meals",
        ...values,
      })
      .returning({ id: locations.id });
    return row!.id;
  }

  it("reads the one venue's settings", async () => {
    const [catalogue] = await suite.db
      .insert(catalogues)
      .values({ name: "Main menu" })
      .returning({ id: catalogues.id });
    await insertVenue({
      name: "Bar Tenerife",
      invoiceLocales: ["es", "en"],
      operationDescription: "Food and drink",
      fiscalTerritory: "ES-canary",
      addressLine1: "Calle Mayor 1",
      addressLine2: "Bajo",
      postalCode: "38001",
      city: "Santa Cruz",
      province: "Santa Cruz de Tenerife",
      timeZone: "Atlantic/Canary",
      dayCutover: "04:30:00",
      catalogueId: catalogue!.id,
    });

    // toEqual, not toMatchObject: a key left out of a matcher is never checked at all.
    expect(await withTransaction(suite.db, readVenue)).toEqual({
      name: "Bar Tenerife",
      invoiceLocales: ["es", "en"],
      operationDescription: "Food and drink",
      fiscalTerritory: "ES-canary",
      addressLine1: "Calle Mayor 1",
      addressLine2: "Bajo",
      postalCode: "38001",
      city: "Santa Cruz",
      province: "Santa Cruz de Tenerife",
      timeZone: "Atlantic/Canary",
      dayCutover: "04:30:00",
      defaultCatalogueId: catalogue!.id,
    });
  });

  it("reads the clock as stored, cutovers in date order as HH:MM", async () => {
    const id = await insertVenue({
      timeZone: "Atlantic/Canary",
      dayCutover: "04:30:00",
      province: "Las Palmas",
      city: "Telde",
    });
    await suite.db.insert(locationDayCutoverChanges).values([
      { locationId: id, effectiveBusinessDay: "2026-03-10", dayCutover: "05:00:00" },
      { locationId: id, effectiveBusinessDay: "2026-02-01", dayCutover: "03:15:00" },
    ]);
    const clock = {
      timeZone: "Atlantic/Canary",
      dayCutover: "04:30",
      cutoverChanges: [
        { effectiveBusinessDay: "2026-02-01", dayCutover: "03:15" },
        { effectiveBusinessDay: "2026-03-10", dayCutover: "05:00" },
      ],
    };

    expect(await withTransaction(suite.db, readVenueClock)).toEqual(clock);
    expect(await withTransaction(suite.db, readVenueClockAndPlace)).toEqual({
      clock,
      place: { province: "Las Palmas", city: "Telde" },
    });
  });

  it("returns a saved zone that is not valid as it is", async () => {
    await insertVenue({ timeZone: "Invalid/Zone" });

    expect((await withTransaction(suite.db, readVenueClock)).timeZone).toBe("Invalid/Zone");
  });

  it("returns the venue's row id", async () => {
    const id = await insertVenue();

    expect(await withTransaction(suite.db, venueLocationId)).toBe(id);
  });

  describe.each<[string, (tx: Transaction) => Promise<unknown>]>([
    ["readVenue", readVenue],
    ["readVenueClock", readVenueClock],
    ["readVenueClockAndPlace", readVenueClockAndPlace],
    ["venueLocationId", venueLocationId],
  ])("%s", (_name, read) => {
    it("refuses with no venue", async () => {
      await expect(withTransaction(suite.db, read)).rejects.toMatchObject({
        code: "venue.not_found",
        params: {},
      });
    });

    it("refuses with two venues", async () => {
      await insertVenue();
      await insertVenue({ name: "Second" });

      await expect(withTransaction(suite.db, read)).rejects.toMatchObject({
        code: "provisioning.second_venue",
        params: {},
      });
    });
  });
});
