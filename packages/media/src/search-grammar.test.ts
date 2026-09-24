import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listImages, uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { samplePreparedImage } from "./testing/sample-image.js";

/**
 * The query grammar `listImages` accepts: quoted phrases, `-` for exclusion, and `or`.
 *
 * The suite seeds ONCE and does not reset between tests, so the punctuation block below adds rows
 * the exclusion block cannot see: it runs after it, and every one of its cases asks only whether
 * its OWN image came back.
 */
const NAMES = ["Bread roll", "Bread loaf", "Roll bread", "Bread with roll", "Fish plate"];

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS],
  resetPerTest: false,
  setup: async (db: Database) => {
    await withTransaction(db, async (tx) => {
      for (const [index, name] of NAMES.entries()) {
        await uploadImage(
          tx,
          {
            image: await samplePreparedImage({ width: 8 + index }),
            names: { en: name },
            altText: { en: "Photo" },
            labels: [],
          },
          { fallbackLanguage: "en" },
        );
      }
    });
  },
});

describe("exclusions, phrases and or", () => {
  it("holds the five names the cases below are written against", async () => {
    const result = await withTransaction(suite.db, (tx) =>
      listImages(tx, { fallbackLanguage: "en" }),
    );
    expect(result.images.map((image) => image.names.en).sort()).toEqual([...NAMES].sort());
  });

  // The library's first load sends `sort=relevance` with no query, and that pair must return the
  // library rather than nothing. `listImages` meets it by falling back to a date ordering
  // (`images.ts`'s `effectiveSort`).
  it("returns rows for the default relevance sort when the search is empty", async () => {
    const result = await withTransaction(suite.db, (tx) =>
      listImages(tx, { query: "", sort: "relevance", limit: 100, fallbackLanguage: "en" }),
    );
    expect(result.images.map((image) => image.names.en).sort()).toEqual([...NAMES].sort());
    expect(result.total).toBe(NAMES.length);
  });

  it.each<[string, string[]]>([
    ["-bread", ["Fish plate"]],
    ["bread -roll", ["Bread loaf"]],
    ['"bread roll"', ["Bread roll"]],
    ['-"bread roll"', ["Bread loaf", "Bread with roll", "Fish plate", "Roll bread"]],
    ["bread -roll OR fish", ["Bread loaf", "Fish plate"]],
    // `or` binds LOOSER than the implicit `and`: this is `(bread and loaf) or fish`, and the other
    // reading — `bread and (loaf or fish)` — would drop "Fish plate".
    ["bread loaf OR fish", ["Bread loaf", "Fish plate"]],
    // A phrase is consecutive words, so the same two words apart do not match it.
    ['"roll bread"', ["Roll bread"]],
  ])("answers %s with %j", async (query, expected) => {
    await withTransaction(suite.db, async (tx) => {
      const result = await listImages(tx, { query, fallbackLanguage: "en" });
      expect(result.images.map((image) => image.names.en).sort()).toEqual(expected);
      expect(result.total).toBe(expected.length);
    });
  });

  // An `or` with nothing before it must not leave an empty group behind: an empty group has no
  // term to fail, so it would match every image.
  it.each<[string, string[]]>([
    ["OR fish", ["Fish plate"]],
    ["loaf OR OR fish", ["Bread loaf", "Fish plate"]],
  ])("does not let a leading or doubled OR match everything: %s", async (query, expected) => {
    await withTransaction(suite.db, async (tx) => {
      const result = await listImages(tx, { query, fallbackLanguage: "en" });
      expect(result.images.map((image) => image.names.en).sort()).toEqual(expected);
    });
  });
});

describe("punctuation and degenerate queries", () => {
  it.each([
    { marker: 1, name: "Chef's bread", query: "chef's", matched: true },
    { marker: 2, name: "Back\\slash", query: "Back\\slash", matched: true },
    { marker: 3, name: "Pan-fried", query: "pan-fried", matched: true },
    // Stopwords stay searchable: the tokenizer removes nothing.
    { marker: 4, name: "The plate", query: "the", matched: true },
    { marker: 5, name: "The plate", query: "-the", matched: false },
    { marker: 6, name: "Toast", query: "", matched: true },
    // A query holding no word at all matches nothing.
    { marker: 7, name: "Toast", query: "---", matched: false },
    { marker: 8, name: "Toast", query: "!!!", matched: false },
    { marker: 9, name: "Toast", query: "\\", matched: false },
    { marker: 10, name: "Toast", query: '""', matched: false },
  ])("handles $query against $name", async ({ marker, name, query, matched }) => {
    await withTransaction(suite.db, async (tx) => {
      // The marker keeps each case's bytes distinct: identical bytes are the SAME image, and two
      // cases sharing one would stop being two cases.
      const { image } = await uploadImage(
        tx,
        {
          image: await samplePreparedImage({ width: 100 + marker }),
          names: { en: name },
          altText: { en: "Photo" },
          labels: [],
        },
        { fallbackLanguage: "en" },
      );
      const result = await listImages(tx, { query, limit: 100, fallbackLanguage: "en" });
      expect(result.images.some((row) => row.id === image.id)).toBe(matched);
    });
  });
});
