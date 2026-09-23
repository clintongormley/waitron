import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  locationCatalogues,
  locations,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_PROVISIONING } from "./provisioning.js";
import { contentLanguages } from "./schema/menu.js";
import { units } from "./schema/units.js";
import { getSeededUnit } from "./units.js";

// This suite checks seeded values and idempotence; it makes no privilege or contention claim.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/**
 * Every write and read below goes through its drizzle table.
 *
 * Two reasons, and both are engine facts rather than style. A row's `id` comes from the table's
 * own `$defaultFn` and not from a SQL default, so a raw `insert` naming the other columns is
 * refused `NOT NULL constraint failed: locations.id`. And a `json`/`labelList` column stores JSON
 * TEXT: a raw `select` hands back the string, where the column's read mapping hands back the map
 * or the list these assertions are written against. The expected values are untouched; what
 * changed is the door the row goes through.
 */
async function venue(country: string, province: string, receipt: string) {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ country }).where(eq(tenants.id, 1));
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Venue",
      province,
      invoiceLocales: [receipt],
      operationDescription: "Hospitality",
    })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  const nodeId = await seedNode(suite.db, locationId);
  return { locationId, nodeId };
}

async function storedLanguages() {
  return suite.db
    .select({
      default_language: contentLanguages.defaultLanguage,
      languages: contentLanguages.languages,
    })
    .from(contentLanguages);
}

async function storedUnits() {
  return suite.db
    .select({
      seed_key: units.seedKey,
      name: units.name,
      abbreviation: units.abbreviation,
      precision: units.precision,
      hardware_unit: units.hardwareUnit,
    })
    .from(units)
    .orderBy(asc(units.seedKey));
}

describe("catalogue provisioning", () => {
  it.each([
    // Spain is hard-coded to the same three languages whatever the province. The four Spanish rows
    // vary both inputs the seed could plausibly read — province AND receipt locale — and all four
    // expect one identical set: that sameness is the hard-code, written where it can be read. The
    // varied receipt column is what keeps it checkable, so do not level it: with the three en-GB
    // rows changed to es-ES, a seed deriving the Spanish default from the receipt locale passed all
    // eight tests instead of failing three. See the comment in provisioning.ts.
    ["ES", "Madrid", "en-GB", "es", ["es", "ca", "en"]],
    ["ES", "Barcelona", "es-ES", "es", ["es", "ca", "en"]],
    ["ES", "A Coruña", "en-GB", "es", ["es", "ca", "en"]],
    ["ES", "Bizkaia", "en-GB", "es", ["es", "ca", "en"]],
    // Everywhere else still takes its one language from geography.
    ["GB", "London", "es-ES", "en", ["en"]],
    ["XX", "Unknown", "es-ES", "en", ["en"]],
  ])(
    "seeds %s/%s content independently of the %s receipt locale",
    async (country, province, receipt, language, languages) => {
      const node = await venue(country, province, receipt);
      await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
      expect(await storedLanguages()).toEqual([{ default_language: language, languages }]);
      const location = await suite.db
        .select({ invoice_locales: locations.invoiceLocales })
        .from(locations)
        .where(eq(locations.id, node.locationId));
      expect(location).toEqual([{ invoice_locales: [receipt] }]);
    },
  );

  it("preserves authored languages and reuses the initial menu on another seed", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = () => withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    await expect(run()).resolves.toBe("initial menu ready");
    await suite.db.update(contentLanguages).set({ defaultLanguage: "fr", languages: ["fr", "de"] });
    await run();
    expect(await storedLanguages()).toEqual([{ default_language: "fr", languages: ["fr", "de"] }]);
    const menus = await suite.db.select({ count: sql<number>`count(*)` }).from(locationCatalogues);
    expect(menus).toEqual([{ count: 1 }]);
  });

  it("seeds the five units once and preserves edits and intentional deletion on another node", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = (nodeId = node.nodeId) =>
      withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, { ...node, nodeId }));
    await run();
    expect(await getSeededUnit(suite.db, "each")).toBeNull();
    expect(await storedUnits()).toEqual([
      {
        seed_key: "g",
        name: { en: "Gram", es: "Gramo", ca: "Gram", gl: "Gramo", eu: "Gramo" },
        abbreviation: { en: "g", es: "g", ca: "g", gl: "g", eu: "g" },
        precision: 0,
        hardware_unit: "g",
      },
      {
        seed_key: "kg",
        name: {
          en: "Kilogram",
          es: "Kilogramo",
          ca: "Quilogram",
          gl: "Quilogramo",
          eu: "Kilogramo",
        },
        abbreviation: { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" },
        precision: 3,
        hardware_unit: "kg",
      },
      {
        seed_key: "l",
        name: { en: "Litre", es: "Litro", ca: "Litre", gl: "Litro", eu: "Litro" },
        abbreviation: { en: "l", es: "l", ca: "l", gl: "l", eu: "l" },
        precision: 3,
        hardware_unit: null,
      },
      {
        seed_key: "mg",
        name: {
          en: "Milligram",
          es: "Miligramo",
          ca: "Mil·ligram",
          gl: "Miligramo",
          eu: "Miligramo",
        },
        abbreviation: { en: "mg", es: "mg", ca: "mg", gl: "mg", eu: "mg" },
        precision: 0,
        hardware_unit: "mg",
      },
      {
        seed_key: "ml",
        name: {
          en: "Millilitre",
          es: "Mililitro",
          ca: "Mil·lilitre",
          gl: "Mililitro",
          eu: "Mililitro",
        },
        abbreviation: { en: "ml", es: "ml", ca: "ml", gl: "ml", eu: "ml" },
        precision: 0,
        hardware_unit: null,
      },
    ]);
    await suite.db
      .update(units)
      .set({ name: { en: "piece", es: "pieza" } })
      .where(eq(units.seedKey, "g"));
    await suite.db.delete(units).where(eq(units.seedKey, "mg"));
    const otherNode = await seedNode(suite.db, node.locationId);
    await run(otherNode);
    expect((await storedUnits()).find((unit) => unit.seed_key === "g")?.name).toEqual({
      en: "piece",
      es: "pieza",
    });
    expect((await storedUnits()).map((unit) => unit.seed_key)).not.toContain("mg");
  });
});
