import { describe, expect, it } from "vitest";
import { contentLanguageChoices } from "@waitron/shared";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  CATALOGUE_CONFIGURATION_TRANSFER,
  validateCatalogueConfiguration,
} from "./configuration-transfer.js";

const geography = { country: "ES", area: "Barcelona" };
const setting = (languages: unknown, default_language: unknown = "en") => ({
  content_languages: [{ id: 1, default_language, languages }],
});
const invalid = expect.objectContaining({ code: "content.languages_invalid", params: {} });

it("keeps Catalan enabled on import while allowing English as the default", () => {
  expect(() => validateCatalogueConfiguration(setting('["en","es"]'), geography)).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: "ca" } }),
  );
  expect(() =>
    validateCatalogueConfiguration(setting('["en","es","ca"]'), geography),
  ).not.toThrow();
});

it("requires geography for a saved-language row", () => {
  expect(() => validateCatalogueConfiguration(setting('["en"]'))).toThrowError(
    expect.objectContaining({ code: "setup.request_invalid", params: { field: "venue" } }),
  );
});

it("refuses a missing required-language setting but accepts absence without regional requirements", () => {
  expect(() => validateCatalogueConfiguration({ content_languages: [] }, geography)).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: "ca" } }),
  );
  expect(() =>
    validateCatalogueConfiguration({ content_languages: [] }, { country: "GB", area: null }),
  ).not.toThrow();
});

it("refuses multiple saved-language rows before import", () => {
  const row = setting('["en","es","ca"]').content_languages[0]!;
  expect(() =>
    validateCatalogueConfiguration({ content_languages: [row, row] }, geography),
  ).toThrowError(invalid);
});

it("refuses another singleton id with a domain error", () => {
  const input = setting('["en","ca","es"]');
  input.content_languages[0]!.id = 2;
  expect(() => validateCatalogueConfiguration(input, geography)).toThrowError(invalid);
});

describe("destination language requirements", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
  it("refuses a destination with no taxpayer before importing its language setting", async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, setting('["en","es","ca"]')),
      ),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "venue" } });
  });
  it("reads the destination country and province before accepting its language setting", async () => {
    await seedVenue(suite.db, { province: "Barcelona" });
    await expect(
      withTransaction(suite.db, (tx) =>
        CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, setting('["en","es"]')),
      ),
    ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
    await withTransaction(suite.db, (tx) =>
      CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, setting('["en","es","ca"]')),
    );
    await withTransaction(suite.db, (tx) => tx.execute(sql`update tenants set country = 'GB'`));
    await withTransaction(suite.db, (tx) =>
      CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, setting('["en"]')),
    );
    expect(
      (await suite.db.execute(sql`select count(*) as count from content_languages`)).rows,
    ).toEqual([{ count: 0 }]);
  });
});

it.each([
  ["{", "en"],
  ["null", "en"],
  ["{}", "en"],
  ['["en",2]', "en"],
  ['["en","en"]', "en"],
  ['["en"]', "es"],
  ['["en"]', null],
  [["en"], "en"],
  ['["en","not_a_language"]', "en"],
  ['["EN"]', "EN"],
  ['["en","ES-es"]', "en"],
])("refuses malformed language list %j with default %j", (languages, defaultLanguage) => {
  expect(() =>
    validateCatalogueConfiguration(setting(languages, defaultLanguage), geography),
  ).toThrowError(invalid);
});

it("holds an imported setting to 200 languages without changing the saved order", () => {
  const languages = contentLanguageChoices("en")
    .slice(0, 201)
    .map(({ code }) => code);
  const input = setting(JSON.stringify(languages), languages[199]);
  expect(() => validateCatalogueConfiguration(input, { country: "GB", area: null })).toThrowError(
    invalid,
  );
  input.content_languages[0]!.languages = JSON.stringify(languages.slice(0, 200));
  const before = structuredClone(input);
  validateCatalogueConfiguration(input, { country: "GB", area: null });
  expect(input).toEqual(before);
});
