import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_PROVISIONING } from "./provisioning.js";
import { getSeededUnit } from "./units.js";

// This suite checks seeded values and idempotence; it makes no privilege or contention claim.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

async function venue(country: string, province: string, receipt: string) {
  const tenantId = await seedTenant(suite.db);
  await suite.db.execute(sql`update tenants set country = ${country} where id = ${tenantId}`);
  const location = await suite.db.execute<{ id: string }>(sql`
    insert into locations (name, province, invoice_locales, operation_description) values ('Venue', ${province}, array[${receipt}], 'Hospitality') returning id`);
  const locationId = brandLocationId(location.rows[0]!.id);
  const nodeId = await seedNode(suite.db, tenantId, locationId);
  return { tenantId, locationId, nodeId };
}

async function storedLanguages() {
  return (
    await suite.db.execute<{ default_language: string; languages: string[] }>(sql`
    select default_language, languages from content_languages`)
  ).rows;
}

async function storedUnits() {
  return (
    await suite.db.execute<{
      seed_key: string;
      name: Record<string, string>;
      abbreviation: Record<string, string>;
      precision: number;
      hardware_unit: string | null;
    }>(sql`
      select seed_key, name, abbreviation, precision, hardware_unit from units order by seed_key`)
  ).rows;
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
      await suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
      expect(await storedLanguages()).toEqual([{ default_language: language, languages }]);
      const location = await suite.db.execute<{ invoice_locales: string[] }>(sql`
      select invoice_locales from locations where id = ${node.locationId}`);
      expect(location.rows).toEqual([{ invoice_locales: [receipt] }]);
    },
  );

  it("preserves authored languages and reuses the initial menu on another seed", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = () => suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    await expect(run()).resolves.toBe("initial menu ready");
    await suite.db.execute(
      sql`update content_languages set default_language = 'fr', languages = array['fr','de']`,
    );
    await run();
    expect(await storedLanguages()).toEqual([{ default_language: "fr", languages: ["fr", "de"] }]);
    const menus = await suite.db.execute<{ count: number }>(sql`
      select count(*)::int as count from location_catalogues`);
    expect(menus.rows).toEqual([{ count: 1 }]);
  });

  it("seeds the five units once and preserves edits and intentional deletion on another node", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = (nodeId = node.nodeId) =>
      suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, { ...node, nodeId }));
    await run();
    await suite.db.transaction(async (tx) => {
      expect(await getSeededUnit(tx, "each")).toBeNull();
    });
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
    await suite.db.execute(sql`
      update units set name = '{"en":"piece","es":"pieza"}'::jsonb
      where seed_key = 'g'`);
    await suite.db.execute(sql`
      delete from units where seed_key = 'mg'`);
    const otherNode = await seedNode(suite.db, node.tenantId, node.locationId);
    await run(otherNode);
    expect((await storedUnits()).find((unit) => unit.seed_key === "g")?.name).toEqual({
      en: "piece",
      es: "pieza",
    });
    expect((await storedUnits()).map((unit) => unit.seed_key)).not.toContain("mg");
  });
});
