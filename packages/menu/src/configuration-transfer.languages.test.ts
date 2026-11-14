import { describe, expect, it } from "vitest";
import { contentLanguageChoices } from "@waitron/shared";
import { CORE_MIGRATIONS, readVenueSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import {
  CATALOGUE_CONFIGURATION_TRANSFER,
  validateCatalogueConfiguration,
} from "./configuration-transfer.js";

const geography = { country: "ES", area: "Barcelona" };
const setting = (languages: unknown, defaultLanguage: unknown = "en") => ({
  defaultLanguage,
  languages,
});
const check = (
  contentLanguages: unknown,
  place: { country: string; area: string | null } = geography,
) =>
  validateCatalogueConfiguration({}, { ...place, contentLanguages } as Parameters<
    typeof validateCatalogueConfiguration
  >[1]);
const invalid = expect.objectContaining({ code: "content.languages_invalid", params: {} });

it("keeps Catalan enabled on import while allowing English as the default", () => {
  expect(() => check(setting(["en", "es"]))).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: "ca" } }),
  );
  expect(() => check(setting(["en", "es", "ca"]))).not.toThrow();
});

it("requires geography for a saved-language policy", () => {
  expect(() =>
    validateCatalogueConfiguration({}, { contentLanguages: setting(["en"]) } as Parameters<
      typeof validateCatalogueConfiguration
    >[1]),
  ).toThrowError(
    expect.objectContaining({ code: "setup.request_invalid", params: { field: "venue" } }),
  );
});

it("refuses a missing required-language setting but accepts absence without regional requirements", () => {
  expect(() => check(null)).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: "ca" } }),
  );
  expect(() => check(null, { country: "GB", area: null })).not.toThrow();
});

describe("destination language requirements", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const imported = (languages: string[]) => ({
    ...geography,
    contentLanguages: setting(languages),
  });
  it("refuses a destination with no taxpayer before importing its language setting", async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, {}, imported(["en", "es", "ca"])),
      ),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "venue" } });
  });
  it("reads the destination country and province before accepting its language setting", async () => {
    await seedVenue(suite.db, { province: "Barcelona" });
    await expect(
      withTransaction(suite.db, (tx) =>
        CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, {}, imported(["en", "es"])),
      ),
    ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
    await withTransaction(suite.db, (tx) =>
      CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, {}, imported(["en", "es", "ca"])),
    );
    await withTransaction(suite.db, (tx) => tx.execute(sql`update tenants set country = 'GB'`));
    await withTransaction(suite.db, (tx) =>
      CATALOGUE_CONFIGURATION_TRANSFER.beforeImport(tx, {}, imported(["en"])),
    );
    expect((await readVenueSettings(suite.db)).doc.contentLanguages).toBeNull();
  });
});

it.each([
  ["{", "en"],
  [null, "en"],
  [{}, "en"],
  [["en", 2], "en"],
  [["en", "en"], "en"],
  [["en"], "es"],
  [["en"], null],
  [["en", "not_a_language"], "en"],
  [["EN"], "EN"],
  [["en", "ES-es"], "en"],
])("refuses malformed language list %j with default %j", (languages, defaultLanguage) => {
  expect(() => check(setting(languages, defaultLanguage))).toThrowError(invalid);
});

it("holds an imported setting to 200 languages without changing the saved order", () => {
  const languages = contentLanguageChoices("en")
    .slice(0, 201)
    .map(({ code }) => code);
  const input = setting(languages, languages[199]);
  expect(() => check(input, { country: "GB", area: null })).toThrowError(invalid);
  input.languages = languages.slice(0, 200);
  const before = structuredClone(input);
  check(input, { country: "GB", area: null });
  expect(input).toEqual(before);
});
