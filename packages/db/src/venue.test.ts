import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { catalogues } from "./schema/catalogue.js";
import { locationDayCutoverChanges } from "./schema/business-day-clock.js";
import { locations } from "./schema/tenants.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";
import {
  readVenue,
  readVenueClock,
  readVenueClockAndPlace,
  readVenueInvoiceLocales,
  venueLocationId,
} from "./venue.js";

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

  async function selectsDuring<T>(read: (tx: Transaction) => Promise<T>) {
    const statements: string[] = [];
    const session = (
      suite.db as unknown as { session: { prepareQuery: (...a: unknown[]) => unknown } }
    ).session;
    const original = session.prepareQuery.bind(session);
    const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
      const { sql } = args[0] as { sql: string };
      if (sql.startsWith("select")) statements.push(sql);
      return original(...args);
    });
    try {
      return { result: await withTransaction(suite.db, read), statements };
    } finally {
      spy.mockRestore();
    }
  }

  it("reads the clock and place in one statement", async () => {
    const id = await insertVenue({ dayCutover: "05:00:00", province: "Madrid", city: "Getafe" });
    await suite.db
      .insert(locationDayCutoverChanges)
      .values({ locationId: id, effectiveBusinessDay: "2026-04-01", dayCutover: "06:00:00" });

    const { result, statements } = await selectsDuring(readVenueClockAndPlace);

    expect(result).toEqual({
      clock: {
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        cutoverChanges: [{ effectiveBusinessDay: "2026-04-01", dayCutover: "06:00" }],
      },
      place: { province: "Madrid", city: "Getafe" },
    });
    expect(statements).toHaveLength(1);
  });

  it("reads a venue with no cutover changes as having none", async () => {
    await insertVenue({ dayCutover: "05:00:00" });

    expect(await withTransaction(suite.db, readVenueClock)).toEqual({
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      cutoverChanges: [],
    });
  });

  it("reads a venue with several cutover changes as one venue, changes in date order", async () => {
    const id = await insertVenue();
    await suite.db.insert(locationDayCutoverChanges).values([
      { locationId: id, effectiveBusinessDay: "2026-05-01", dayCutover: "07:00:00" },
      { locationId: id, effectiveBusinessDay: "2026-01-15", dayCutover: "03:00:00" },
      { locationId: id, effectiveBusinessDay: "2026-03-01", dayCutover: "05:30:00" },
    ]);

    expect((await withTransaction(suite.db, readVenueClock)).cutoverChanges).toEqual([
      { effectiveBusinessDay: "2026-01-15", dayCutover: "03:00" },
      { effectiveBusinessDay: "2026-03-01", dayCutover: "05:30" },
      { effectiveBusinessDay: "2026-05-01", dayCutover: "07:00" },
    ]);
  });

  it("refuses two venues when one of them has cutover changes", async () => {
    const id = await insertVenue();
    await insertVenue({ name: "Second" });
    await suite.db.insert(locationDayCutoverChanges).values([
      { locationId: id, effectiveBusinessDay: "2026-01-15", dayCutover: "03:00:00" },
      { locationId: id, effectiveBusinessDay: "2026-03-01", dayCutover: "05:30:00" },
    ]);

    const error: unknown = await withTransaction(suite.db, readVenueClockAndPlace).catch(
      (caught) => caught,
    );
    expect(error).toMatchObject({ code: "provisioning.second_venue" });
    expect((error as { params: unknown }).params).toEqual({});
  });

  it("returns a saved zone that is not valid as it is", async () => {
    await insertVenue({ timeZone: "Invalid/Zone" });

    expect((await withTransaction(suite.db, readVenueClock)).timeZone).toBe("Invalid/Zone");
  });

  it("reads the invoice languages in their saved order, selecting no other column", async () => {
    await insertVenue({ invoiceLocales: ["gl-ES", "es-ES"], addressLine1: "Calle Mayor 1" });

    const { result, statements } = await selectsDuring(readVenueInvoiceLocales);

    expect(result).toEqual(["gl-ES", "es-ES"]);
    expect(statements).toEqual(['select "invoice_locales" from "locations" limit ?']);
  });

  it("returns the venue's row id", async () => {
    const id = await insertVenue();

    expect(await withTransaction(suite.db, venueLocationId)).toBe(id);
  });

  describe.each<[string, (tx: Transaction) => Promise<unknown>]>([
    ["readVenue", readVenue],
    ["readVenueClock", readVenueClock],
    ["readVenueClockAndPlace", readVenueClockAndPlace],
    ["readVenueInvoiceLocales", readVenueInvoiceLocales],
    ["venueLocationId", venueLocationId],
  ])("%s", (_name, read) => {
    it("refuses with no venue", async () => {
      const error: unknown = await withTransaction(suite.db, read).catch((caught) => caught);
      expect(error).toMatchObject({ code: "venue.not_found" });
      // toMatchObject reads `params: {}` as "any params"; the params must be empty.
      expect((error as { params: unknown }).params).toEqual({});
    });

    it("refuses with two venues", async () => {
      await insertVenue();
      await insertVenue({ name: "Second" });

      const error: unknown = await withTransaction(suite.db, read).catch((caught) => caught);
      expect(error).toMatchObject({ code: "provisioning.second_venue" });
      // toMatchObject reads `params: {}` as "any params"; the params must be empty.
      expect((error as { params: unknown }).params).toEqual({});
    });
  });
});
