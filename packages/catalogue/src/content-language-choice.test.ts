import { contentLanguageChoices } from "@waitron/shared";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { readContentLanguages, writeContentLanguages } from "./content-languages.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

it("keeps required enabled languages while freely choosing a default", async () => {
  await withTransaction(suite.db, (tx) =>
    writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en"] }, [
      "ca",
      "es",
    ]),
  );
  await expect(
    withTransaction(suite.db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }, ["ca", "es"]),
    ),
  ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
  expect(await withTransaction(suite.db, (tx) => readContentLanguages(tx, "en"))).toEqual({
    defaultLanguage: "ca",
    languages: ["ca", "es", "en"],
  });
});

it.each([
  { defaultLanguage: "en", languages: [] },
  { defaultLanguage: "en", languages: ["es"] },
  { defaultLanguage: "en", languages: ["en", "en-GB"] },
  {
    defaultLanguage: contentLanguageChoices("en")[0]!.code,
    languages: contentLanguageChoices("en")
      .slice(0, 201)
      .map(({ code }) => code),
  },
])(
  "refuses invalid membership, duplicate or over-cap configuration without writing %j",
  async (config) => {
    await withTransaction(suite.db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es"] }),
    );
    await expect(
      withTransaction(suite.db, (tx) => writeContentLanguages(tx, config)),
    ).rejects.toMatchObject({ code: "content.languages_invalid", params: {} });
    expect(await withTransaction(suite.db, (tx) => readContentLanguages(tx, "en"))).toEqual({
      defaultLanguage: "es",
      languages: ["es"],
    });
  },
);

it("accepts exactly 200 distinct named languages", async () => {
  const languages = contentLanguageChoices("en")
    .slice(0, 200)
    .map(({ code }) => code);
  expect(languages).toHaveLength(200);
  await withTransaction(suite.db, (tx) =>
    writeContentLanguages(tx, { defaultLanguage: languages[199]!, languages }),
  );
  expect(await withTransaction(suite.db, (tx) => readContentLanguages(tx, "en"))).toEqual({
    defaultLanguage: languages[199]!,
    languages: [languages[199]!, ...languages.slice(0, 199)],
  });
});
