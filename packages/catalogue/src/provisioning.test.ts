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
import type { StarterContentLanguage, StarterTranslations } from "@waitron/country-packs";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_PROVISIONING } from "./provisioning.js";
import { contentLanguages, menuDetails } from "./schema/menu.js";
import { readCatalogueSettings, saveCatalogueDefaultColor } from "./settings.js";
import { sections } from "./schema/sections.js";
import { units } from "./schema/units.js";
import { getSeededUnit } from "./units.js";
import { STARTER_UNIT_NAMES } from "./starter-content.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const expected: StarterTranslations<StarterContentLanguage> = STARTER_UNIT_NAMES;

/**
 * Every write and read below goes through its drizzle table. A row's `id` comes from the table's
 * own `$defaultFn` and not from a SQL default, and a `json`/`labelList` column stores JSON TEXT: a
 * raw `select` hands back the string, where the column's read mapping hands back the map or the list
 * these assertions are written against.
 */
async function venue(country: string, province: string, receipt: string | string[]) {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ country }).where(eq(tenants.id, 1));
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Venue",
      province,
      invoiceLocales: typeof receipt === "string" ? [receipt] : receipt,
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
      measure: units.measure,
    })
    .from(units)
    .orderBy(asc(units.seedKey));
}

describe("catalogue provisioning", () => {
  it.each([
    ["ES", "reduced"],
    ["GB", "general"],
    ["XX", "general"],
  ])("seeds the new-product VAT default for %s as %s", async (country, expected) => {
    const node = await venue(country, "Madrid", "es-ES");
    await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    const names = await suite.db.execute<{ name: string }>(sql`
      select name from sqlite_master where type = 'table' and name = 'catalogue_settings'`);
    expect(names.rows).toEqual([{ name: "catalogue_settings" }]);
    const stored = await suite.db.execute<{ default_product_vat_class: string }>(sql`
      select default_product_vat_class from catalogue_settings where id = 1`);
    expect(stored.rows).toEqual([{ default_product_vat_class: expected }]);
  });

  it("preserves an authored VAT default when another node is seeded", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = () => withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    await run();
    const names = await suite.db.execute<{ name: string }>(sql`
      select name from sqlite_master where type = 'table' and name = 'catalogue_settings'`);
    expect(names.rows).toEqual([{ name: "catalogue_settings" }]);
    await suite.db.execute(
      sql`update catalogue_settings set default_product_vat_class = 'zero' where id = 1`,
    );
    await run();
    const stored = await suite.db.execute<{ default_product_vat_class: string }>(sql`
      select default_product_vat_class from catalogue_settings where id = 1`);
    expect(stored.rows).toEqual([{ default_product_vat_class: "zero" }]);
  });

  it("seeds the All products default colour as pale blue", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    const settings = await withTransaction(suite.db, (tx) => readCatalogueSettings(tx));
    expect(settings.defaultColor).toBe("#abcced");
  });

  it.each([null, "#edabab"])(
    "keeps an authored All products default colour of %s when another node is seeded",
    async (authored) => {
      const node = await venue("ES", "Madrid", "es-ES");
      const run = () =>
        withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
      await run();
      await withTransaction(suite.db, (tx) => saveCatalogueDefaultColor(tx, authored));
      await run();
      const settings = await withTransaction(suite.db, (tx) => readCatalogueSettings(tx));
      expect(settings.defaultColor).toBe(authored);
    },
  );

  it.each([
    // A venue starts with its default language, the languages Waitron keeps enabled for its area,
    // and English. The Spanish rows vary both inputs the seed could plausibly read — province AND
    // receipt locale — and the receipt column must never change the result, so do not level it.
    // See docs/developers/products.md → "Content languages per region".
    ["ES", "Madrid", "en-GB", "es", ["es", "en"]],
    ["ES", "Barcelona", "es-ES", "ca", ["ca", "es", "en"]],
    ["ES", "Valencia", "en-GB", "ca-ES-valencia", ["ca-ES-valencia", "es", "en"]],
    ["ES", "Illes Balears", "es-ES", "ca", ["ca", "es", "en"]],
    ["ES", "A Coruña", "en-GB", "gl", ["gl", "es", "en"]],
    ["ES", "Bizkaia", "en-GB", "es", ["es", "en"]],
    // Outside Spain: the pack's language plus English; with no pack, English alone.
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
    // The initial menu got its root and default layout once, not once per seed.
    const [menu] = await suite.db
      .select({ catalogueId: locations.catalogueId })
      .from(locations)
      .where(eq(locations.id, node.locationId));
    const owned = await suite.db
      .select({ role: sections.role })
      .from(sections)
      .where(eq(sections.ownerMenuId, menu!.catalogueId!))
      .orderBy(asc(sections.role));
    expect(owned).toEqual([{ role: "home_layout" }, { role: "menu_root" }]);
    expect(await suite.db.select().from(menuDetails)).toEqual([
      expect.objectContaining({ menuId: menu!.catalogueId }),
    ]);
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
        name: { en: "Gram", es: expected["Gram"]!.es },
        abbreviation: { en: "g", es: "g" },
        precision: 0,
        hardware_unit: "g",
        measure: true,
      },
      {
        seed_key: "kg",
        name: { en: "Kilogram", es: expected["Kilogram"]!.es },
        abbreviation: { en: "kg", es: "kg" },
        precision: 3,
        hardware_unit: "kg",
        measure: true,
      },
      {
        seed_key: "l",
        name: { en: "Litre", es: expected["Litre"]!.es },
        abbreviation: { en: "l", es: "l" },
        precision: 3,
        hardware_unit: null,
        measure: true,
      },
      {
        seed_key: "mg",
        name: { en: "Milligram", es: expected["Milligram"]!.es },
        abbreviation: { en: "mg", es: "mg" },
        precision: 0,
        hardware_unit: "mg",
        measure: true,
      },
      {
        seed_key: "ml",
        name: { en: "Millilitre", es: expected["Millilitre"]!.es },
        abbreviation: { en: "ml", es: "ml" },
        precision: 0,
        hardware_unit: null,
        measure: true,
      },
    ]);
    await suite.db
      .update(units)
      .set({ name: { en: "piece" } })
      .where(eq(units.seedKey, "g"));
    await suite.db.delete(units).where(eq(units.seedKey, "mg"));
    const otherNode = await seedNode(suite.db, node.locationId);
    await run(otherNode);
    expect((await storedUnits()).find((unit) => unit.seed_key === "g")?.name).toEqual({
      en: "piece",
    });
    expect((await storedUnits()).map((unit) => unit.seed_key)).not.toContain("mg");
  });
});

it("authors seeded staff pairs independently and preserves staff edits on reseed", async () => {
  const node = await venue("ES", "Madrid", "es-ES");
  await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
  const staffPairs = () =>
    suite.db
      .select({
        seedKey: units.seedKey,
        staffName: units.staffName,
        staffAbbreviation: units.staffAbbreviation,
      })
      .from(units)
      .orderBy(asc(units.seedKey));
  expect(await staffPairs()).toEqual([
    { seedKey: "g", staffName: expected["Gram"]!.es, staffAbbreviation: "g" },
    { seedKey: "kg", staffName: expected["Kilogram"]!.es, staffAbbreviation: "kg" },
    { seedKey: "l", staffName: expected["Litre"]!.es, staffAbbreviation: "l" },
    { seedKey: "mg", staffName: expected["Milligram"]!.es, staffAbbreviation: "mg" },
    { seedKey: "ml", staffName: expected["Millilitre"]!.es, staffAbbreviation: "ml" },
  ]);
  await suite.db
    .update(units)
    .set({ staffName: "Mass", staffAbbreviation: "M", name: {}, abbreviation: {} })
    .where(eq(units.seedKey, "kg"));
  await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
  expect((await staffPairs()).find((unit) => unit.seedKey === "kg")).toEqual({
    seedKey: "kg",
    staffName: "Mass",
    staffAbbreviation: "M",
  });
});

// Each venue the two sides could treat differently: a regional content language that is not `ca`
// (Valencia), a receipt language the staff screens cannot show (Barcelona's `ca-ES`), a receipt
// language that overrides the area (Madrid's `en-GB`, alone and first of two), one language (London).
const STARTER_VENUES: readonly [string, string, string | string[], "es" | "en", string[]][] = [
  ["ES", "Valencia", "es-ES", "es", ["ca-ES-valencia", "es", "en"]],
  ["ES", "Barcelona", "ca-ES", "es", ["ca", "es", "en"]],
  ["ES", "Madrid", "en-GB", "en", ["es", "en"]],
  ["ES", "Madrid", ["en-GB", "es-ES"], "en", ["es", "en"]],
  ["GB", "London", "en-GB", "en", ["en"]],
];

const STARTER_UNIT_ROWS = [
  { seedKey: "g", english: "Gram", abbreviation: "g" },
  { seedKey: "kg", english: "Kilogram", abbreviation: "kg" },
  { seedKey: "l", english: "Litre", abbreviation: "l" },
  { seedKey: "mg", english: "Milligram", abbreviation: "mg" },
  { seedKey: "ml", english: "Millilitre", abbreviation: "ml" },
];

async function seededUnits() {
  return suite.db
    .select({
      seedKey: units.seedKey,
      staffName: units.staffName,
      staffAbbreviation: units.staffAbbreviation,
      name: units.name,
      abbreviation: units.abbreviation,
    })
    .from(units)
    .orderBy(asc(units.seedKey));
}

it.each(STARTER_VENUES)(
  "seeds each %s/%s (receipts %j) unit in the %s staff language with a name in each of %j",
  async (country, province, receipt, staffLanguage, languages) => {
    const node = await venue(country, province, receipt);
    await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    expect(await seededUnits()).toEqual(
      STARTER_UNIT_ROWS.map(({ seedKey, english, abbreviation }) => ({
        seedKey,
        staffName: staffLanguage === "en" ? english : expected[english]![staffLanguage],
        staffAbbreviation: abbreviation,
        name: Object.fromEntries(
          languages.map((language) => [
            language,
            language === "en" ? english : expected[english]![language as StarterContentLanguage],
          ]),
        ),
        abbreviation: Object.fromEntries(languages.map((language) => [language, abbreviation])),
      })),
    );
  },
);

it.each(STARTER_VENUES)(
  "gives every seeded %s/%s (receipts %j) unit its staff abbreviation in every language it names",
  async (country, province, receipt) => {
    const node = await venue(country, province, receipt);
    await withTransaction(suite.db, (tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    const seeded = await seededUnits();
    expect(seeded).toHaveLength(STARTER_UNIT_ROWS.length);
    for (const unit of seeded) {
      expect(Object.keys(unit.abbreviation).sort()).toEqual(Object.keys(unit.name).sort());
      for (const text of Object.values(unit.abbreviation)) {
        expect(text).toBe(unit.staffAbbreviation);
      }
    }
  },
);
