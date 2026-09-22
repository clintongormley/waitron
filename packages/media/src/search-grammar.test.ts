import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listImages, uploadImage } from "./images.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";

/**
 * The query grammar `listImages` accepts: quoted phrases, `-` for exclusion, and `or`.
 *
 * Every case below is lifted from `search.pg.test.ts`, which asserted the same grammar against
 * PostgreSQL's `websearch_to_tsquery`. That suite needs a container and does not collect on this
 * branch, so the grammar had nothing running behind it — and the grammar is OURS now (`parseSearch`
 * in `images.ts`), not the database's, which is exactly the code a dead suite must not be the only
 * witness for.
 *
 * WHAT IS NOT LIFTED, so nobody reads this as the whole of that suite. Its stemming cases
 * (`bread -rolls`, `roll -rolls`, `"breads with rolls"`) assert that a search finds a word form it
 * does not spell. SQLite has no stemmer and this conversion has none, so those are LEFT FAILING
 * where they are — in `images.test.ts` — rather than restated here in a form that passes. Its role
 * assertions (`current_user`, `rolsuper`) and its `tsvector_to_array` probe describe an engine this
 * branch replaced.
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
            bytes: new Uint8Array([0xff, 0xd8, 0xff, index]),
            names: { en: name },
            altText: { en: "Photo" },
            labels: [],
          },
          { fallbackLanguage: "en", maxUploadBytes: 100 },
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
});

describe("punctuation and degenerate queries", () => {
  it.each([
    { marker: 1, name: "Chef's bread", query: "chef's", matched: true },
    { marker: 2, name: "Back\\slash", query: "Back\\slash", matched: true },
    { marker: 3, name: "Pan-fried", query: "pan-fried", matched: true },
    // Stopwords stay searchable: `media_text_vector` unioned in a `simple` vector to keep them, and
    // this tokenizer removes nothing either.
    { marker: 4, name: "The plate", query: "the", matched: true },
    { marker: 5, name: "The plate", query: "-the", matched: false },
    { marker: 6, name: "Toast", query: "", matched: true },
    // A query holding no word at all is the empty `tsquery`, which matched nothing under `@@`.
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
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 200, marker]),
          names: { en: name },
          altText: { en: "Photo" },
          labels: [],
        },
        { fallbackLanguage: "en", maxUploadBytes: 100 },
      );
      const result = await listImages(tx, { query, limit: 100, fallbackLanguage: "en" });
      expect(result.images.some((row) => row.id === image.id)).toBe(matched);
    });
  });
});
