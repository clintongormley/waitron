import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { kitchenLocaleFor, readKitchenLanguage } from "./kitchen-language.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
describe("A964 venue language", () => {
  it("falls back to English without a saved row", async () => {
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update settings set doc = json_set(doc, '$.contentLanguages', null, '$.defaultContentLanguage', null) where module = 'venue'`,
      );
      expect(await readKitchenLanguage(tx)).toBe("en-GB");
    });
  });
  it.each([
    ["en", "en-GB"],
    ["es", "es-ES"],
    ["es-MX", "es-ES"],
    ["ca-ES-valencia", "en-GB"],
    ["fr", "en-GB"],
    ["fr-FR", "en-GB"],
    ["ca", "en-GB"],
  ])("uses saved %s as %s without rewriting it", async (defaultLanguage, expected) => {
    await withTransaction(suite.db, async (tx) => {
      await seedVenueSettings(tx, {
        defaultContentLanguage: defaultLanguage,
        contentLanguages: [defaultLanguage],
      });
      const before = await tx.execute(
        sql`select json_extract(doc, '$.defaultContentLanguage') as default_language from settings where module = 'venue'`,
      );
      expect(await readKitchenLanguage(tx)).toBe(expected);
      const { rows } = await tx.execute(
        sql`select json_extract(doc, '$.defaultContentLanguage') as default_language from settings where module = 'venue'`,
      );
      expect(rows).toEqual(before.rows);
    });
  });
});

it.each([
  ["pt", "BR", "pt-BR"],
  ["pt", "PT", "pt-PT"],
  ["pt", "ES", "pt-PT"],
  ["pt", null, "pt-PT"],
  ["de", "BR", "en-GB"],
] as const)("selects the supported locale for %s in %s", (language, country, expected) => {
  expect(kitchenLocaleFor(language, country, ["pt-PT", "pt-BR"])).toBe(expected);
});
