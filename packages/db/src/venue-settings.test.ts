import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as api from "./index.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { persons } from "./schema/identity/persons.js";
import { locations } from "./schema/tenants.js";
import { settings } from "./schema/settings.js";
import * as seeds from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

const doc = {
  name: "Harbour restaurant",
  addressLine1: "1 Main Street",
  addressLine2: null,
  postalCode: "10001",
  city: "Harbour",
  province: "Coast",
};

describe("the venue document", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("declares a non-transferring core document with invalid defaults", () => {
    expect(api.VENUE_SETTINGS).toMatchObject({ module: "venue", version: 1, transfers: false });
    expect(api.VENUE_SETTINGS.defaults()).toEqual({
      name: "",
      addressLine1: null,
      addressLine2: null,
      postalCode: null,
      city: null,
      province: null,
    });
    expect(api.VENUE_SETTINGS.parse(api.VENUE_SETTINGS.defaults())).toEqual({
      ok: false,
      field: "name",
    });
  });

  it("parses a trimmed name and refuses each malformed field", () => {
    expect(api.VENUE_SETTINGS.parse({ ...doc, name: "  Harbour restaurant  " })).toEqual({
      ok: true,
      doc,
    });
    for (const name of ["", "  ", null, 5])
      expect(api.VENUE_SETTINGS.parse({ ...doc, name })).toEqual({ ok: false, field: "name" });
    for (const field of ["addressLine1", "addressLine2", "postalCode", "city", "province"])
      expect(api.VENUE_SETTINGS.parse({ ...doc, [field]: 42 })).toEqual({ ok: false, field });
    for (const value of [null, [], "venue"])
      expect(api.VENUE_SETTINGS.parse(value)).toEqual({ ok: false, field: "doc" });
    expect(api.VENUE_SETTINGS.parse({ ...doc, extra: true })).toEqual({
      ok: false,
      field: "extra",
    });
  });

  it("keeps the interim location identity independent of the venue document", async () => {
    const [row] = await suite.db
      .insert(locations)
      .values({ invoiceLocales: ["es"], operationDescription: "Meals" })
      .returning({ id: locations.id });
    expect(await api.venueLocationId(suite.db)).toBe(row!.id);
  });

  it("refuses a locations row without its venue document", async () => {
    await suite.db
      .insert(locations)
      .values({ invoiceLocales: ["es"], operationDescription: "Meals" });
    await expect(withTransaction(suite.db, api.readVenue)).rejects.toMatchObject({
      code: "venue.not_found",
      params: {},
    });
  });

  it("merges document fields with the remaining location fields and reads place in the clock query", async () => {
    await suite.db.insert(locations).values({
      invoiceLocales: ["en", "es"],
      operationDescription: "Meals",
      timeZone: "Europe/London",
      dayCutover: "04:00:00",
    });
    await withTransaction(suite.db, (tx) => api.createVenueSettings(tx, doc, null));
    expect(await withTransaction(suite.db, api.readVenue)).toEqual({
      ...doc,
      invoiceLocales: ["en", "es"],
      operationDescription: "Meals",
      fiscalTerritory: "ES-common",
      timeZone: "Europe/London",
      dayCutover: "04:00:00",
      defaultCatalogueId: null,
    });
    expect((await withTransaction(suite.db, api.readVenueClockAndPlace)).place).toEqual({
      province: "Coast",
      city: "Harbour",
    });
  });

  it("keeps unspecified fields and records the saver and next revision", async () => {
    const [person] = await suite.db.insert(persons).values({ displayName: "Owner" }).returning();
    await withTransaction(suite.db, (tx) => api.createVenueSettings(tx, doc, null));
    await withTransaction(suite.db, (tx) =>
      api.saveVenueFields(tx, { name: "New name" }, person!.id),
    );
    expect(await withTransaction(suite.db, api.readVenueSettings)).toEqual({
      doc: { ...doc, name: "New name" },
      revision: 2,
    });
    expect((await suite.db.select().from(settings))[0]!.updatedBy).toBe(person!.id);
    await expect(
      withTransaction(suite.db, (tx) => api.createVenueSettings(tx, doc, null)),
    ).rejects.toMatchObject({
      code: "settings.out_of_date",
      params: { module: "venue", revision: 2 },
    });
  });

  it("creates a seed once, then overwrites only explicit fields", async () => {
    await seeds.seedVenueSettings(suite.db);
    expect(await api.readVenueSettings(suite.db)).toEqual({
      doc: {
        name: "Test venue",
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        province: null,
      },
      revision: 1,
    });
    await seeds.seedVenueSettings(suite.db, doc);
    await seeds.seedVenueSettings(suite.db, { name: "Renamed" });
    expect(await api.readVenueSettings(suite.db)).toEqual({
      doc: { ...doc, name: "Renamed" },
      revision: 3,
    });
  });

  it("the joined clock read refuses the same invalid document version as the settings reader", async () => {
    await suite.db
      .insert(locations)
      .values({ invoiceLocales: ["es"], operationDescription: "Meals" });
    await withTransaction(suite.db, (tx) => api.createVenueSettings(tx, doc, null));
    await suite.db.update(settings).set({ version: 2 }).where(eq(settings.module, "venue"));
    for (const read of [api.readVenueSettings, api.readVenueClockAndPlace])
      await expect(withTransaction(suite.db, read)).rejects.toMatchObject({
        code: "settings.invalid",
        params: { module: "venue", field: "version", version: 2 },
      });
  });
});
