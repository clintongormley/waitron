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
