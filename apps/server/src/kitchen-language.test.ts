import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeContentLanguages } from "@waitron/catalogue";
import { readKitchenLanguage } from "./kitchen-language.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
describe("A964 venue language", () => {
  it("falls back to English without a saved row", async () => {
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`delete from content_languages`);
      expect(await readKitchenLanguage(tx)).toBe("en");
    });
  });
  it.each([
    ["en", "en"],
    ["es", "es"],
    ["es-MX", "es"],
    ["ca-ES-valencia", "en"],
  ])("uses saved %s as %s without rewriting it", async (defaultLanguage, expected) => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage, languages: [defaultLanguage] });
      const before = await tx.execute(sql`select default_language from content_languages`);
      expect(await readKitchenLanguage(tx)).toBe(expected);
      const { rows } = await tx.execute(sql`select default_language from content_languages`);
      expect(rows).toEqual(before.rows);
    });
  });
});
