import { expect, it } from "vitest";
import { madridWithDocument } from "./madrid-documents.js";
import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";
const original: CanonicalMadridSemantics = {
  tables: {
    locations: {
      columns: ["id", "name", "city", "time_zone"].map((name) => ({
        name,
        type: "TEXT",
        notnull: 1,
        pk: name === "id" ? 1 : 0,
        dflt_value: null,
      })),
      foreignKeys: [],
      rows: { place: { id: "place", name: "Deli", city: "Madrid", time_zone: "Europe/Madrid" } },
    },
  },
};
const metadata = {
  module: "venue",
  version: 1,
  revision: 1,
  updatedAt: "2026-10-08T10:00:00.000Z",
  updatedBy: null,
};
it("moves only the named columns into a literal document and keeps the frozen capture unchanged", () => {
  const before = structuredClone(original);
  const result = madridWithDocument(
    original,
    "locations",
    { name: "name", city: "city" },
    metadata,
  );
  expect(result.tables.locations!.columns.map((c) => c.name)).toEqual(["id", "time_zone"]);
  expect(result.tables.locations!.rows).toEqual({
    place: { id: "place", time_zone: "Europe/Madrid" },
  });
  const row = {
    module: "venue",
    version: 1,
    revision: 1,
    doc: { name: "Deli", city: "Madrid" },
    updated_at: metadata.updatedAt,
    updated_by: null,
  };
  expect(result.tables.settings!.rows).toEqual({ [stable(row)]: row });
  expect(original).toEqual(before);
});
it("refuses two source rows and leaves an empty phase with no document", () => {
  const two = structuredClone(original);
  two.tables.locations!.rows.second = { id: "second", name: "Other" };
  expect(() => madridWithDocument(two, "locations", { name: "name" }, metadata)).toThrow(
    "two rows",
  );
  const empty = structuredClone(original);
  empty.tables.locations!.rows = {};
  expect(
    madridWithDocument(empty, "locations", { name: "name" }, metadata).tables.settings!.rows,
  ).toEqual({});
});

it("merges captured table rows into the existing venue document and empties the source", () => {
  const captured = madridWithDocument(
    original,
    "locations",
    { name: "name", city: "city" },
    metadata,
  );
  captured.tables.content_languages = {
    columns: [],
    foreignKeys: [],
    rows: { policy: { default_language: "en", languages: ["en", "es"] } },
  };
  const before = structuredClone(captured);
  const result = madridWithDocument(
    captured,
    "content_languages",
    {
      default_language: "defaultContentLanguage",
      languages: "contentLanguages",
    },
    { ...metadata, revision: 2, mode: "row" },
  );
  expect(Object.values(result.tables.settings!.rows)).toEqual([
    {
      module: "venue",
      version: 1,
      revision: 2,
      doc: {
        name: "Deli",
        city: "Madrid",
        defaultContentLanguage: "en",
        contentLanguages: ["en", "es"],
      },
      updated_at: metadata.updatedAt,
      updated_by: null,
    },
  ]);
  expect(result.tables.content_languages!.rows).toEqual({});
  expect(captured).toEqual(before);
  result.tables.holiday_geographies = { columns: [], foreignKeys: [], rows: {} };
  const emptyArea = madridWithDocument(
    result,
    "holiday_geographies",
    { country: "country" },
    {
      ...metadata,
      revision: 2,
      mode: "row",
      targetField: "holidayArea",
    },
  );
  expect(Object.values(emptyArea.tables.settings!.rows)[0]!.doc).toEqual({
    name: "Deli",
    city: "Madrid",
    defaultContentLanguage: "en",
    contentLanguages: ["en", "es"],
    holidayArea: null,
  });
});
