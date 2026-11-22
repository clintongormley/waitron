import { madridWithSectionColumns } from "./madrid-documents.js";
import * as documents from "./madrid-documents.js";
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
    { default_language: "defaultContentLanguage", languages: "contentLanguages" },
    { ...metadata, revision: 2, mode: "row" },
  );
  const expectedDoc = {
    name: "Deli",
    city: "Madrid",
    defaultContentLanguage: "en",
    contentLanguages: ["en", "es"],
  };
  expect(Object.values(result.tables.settings!.rows)).toEqual([
    {
      module: "venue",
      version: 1,
      revision: 2,
      doc: expectedDoc,
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
    { ...metadata, revision: 2, mode: "row", targetField: "holidayArea" },
  );
  expect(Object.values(emptyArea.tables.settings!.rows)[0]!.doc).toEqual({
    ...expectedDoc,
    holidayArea: null,
  });
});

it("moves a captured clock and its dated starts without changing the frozen input", () => {
  const captured = structuredClone(original);
  captured.tables.locations!.rows.place!.day_cutover = "05:00:00";
  captured.tables.locations!.columns.push({
    name: "day_cutover",
    type: "TEXT",
    notnull: 1,
    pk: 0,
    dflt_value: null,
  });
  captured.tables.location_business_day_settings = {
    columns: [],
    foreignKeys: [],
    rows: { revision: { revision: 2 } },
  };
  captured.tables.location_day_cutover_changes = {
    columns: ["location_id", "effective_business_day", "day_cutover"].map((name, i) => ({
      name,
      type: "TEXT",
      notnull: 1,
      pk: i < 2 ? i + 1 : 0,
      dflt_value: null,
    })),
    foreignKeys: [],
    rows: {
      later: {
        effective_business_day: "2026-12-01",
        day_cutover: "07:00:00",
      },
    },
  };
  const before = structuredClone(captured);
  const result = madridWithDocument(
    captured,
    "locations",
    { time_zone: "timeZone" },
    { ...metadata, module: "business_day", mode: "business-day" },
  );
  expect(Object.values(result.tables.settings!.rows)).toEqual([
    {
      module: "business_day",
      version: 1,
      revision: 3,
      doc: { timeZone: "Europe/Madrid" },
      updated_at: metadata.updatedAt,
      updated_by: null,
    },
  ]);
  expect(Object.values(result.tables.day_cutover_changes?.rows ?? {})).toEqual([
    { effective_business_day: "2000-01-01", day_cutover: "05:00:00" },
    { effective_business_day: "2026-12-01", day_cutover: "07:00:00" },
  ]);
  expect(result.tables.locations!.rows.place).toEqual({
    id: "place",
    name: "Deli",
    city: "Madrid",
  });
  expect(result.tables.locations!.columns.map((column) => column.name)).toEqual([
    "id",
    "name",
    "city",
  ]);
  expect(result.tables.day_cutover_changes!.columns.map(({ name, pk }) => [name, pk])).toEqual([
    ["effective_business_day", 1],
    ["day_cutover", 0],
  ]);
  expect(result.tables.day_cutover_changes!.foreignKeys).toEqual([]);
  expect(result.tables.location_business_day_settings).toBeUndefined();
  expect(result.tables.location_day_cutover_changes).toBeUndefined();
  expect(captured).toEqual(before);
});

it("moves the captured default menu reference to a flag, keeping all menu rows and the capture", () => {
  const captured = structuredClone(original);
  captured.tables.locations!.columns.push({
    name: "catalogue_id",
    type: "TEXT",
    notnull: 0,
    pk: 0,
    dflt_value: null,
  });
  captured.tables.locations!.rows.place!.catalogue_id = "second";
  captured.tables.locations!.foreignKeys = [
    {
      id: 0,
      seq: 0,
      table: "catalogues",
      from: "catalogue_id",
      to: "id",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      match: "NONE",
    },
  ];
  captured.tables.catalogues = {
    columns: [],
    foreignKeys: [],
    rows: { first: { id: "first", name: "Lunch" }, second: { id: "second", name: "Dinner" } },
  };
  const before = structuredClone(captured);
  const result = madridWithDocument(
    captured,
    "locations",
    { catalogue_id: "id" },
    { mode: "column-flag", targetTable: "catalogues", targetField: "is_default" },
  );
  expect(result.tables.catalogues).toEqual({
    columns: [{ name: "is_default", type: "INTEGER", notnull: 1, pk: 0, dflt_value: "false" }],
    foreignKeys: [],
    rows: {
      first: { id: "first", name: "Lunch", is_default: 0 },
      second: { id: "second", name: "Dinner", is_default: 1 },
    },
  });
  expect(result.tables.locations).toEqual(original.tables.locations);
  expect(result.tables.settings).toBeUndefined();
  expect(captured).toEqual(before);
});

it("moves both captured menu settings rows and keeps the capture", () => {
  const captured: CanonicalMadridSemantics = {
    tables: {
      catalogue_settings: {
        columns: [],
        foreignKeys: [],
        rows: { one: { id: 1, default_product_vat_class: "reduced", default_color: "#abcced" } },
      },
      unit_seed_states: { columns: [], foreignKeys: [], rows: { one: { id: 1 } } },
    },
  };
  const before = structuredClone(captured);
  expect(
    documents.madridWithMenuSettings(captured, metadata.updatedAt).tables.settings?.rows,
  ).toEqual({
    [stable({
      module: "menu",
      version: 1,
      revision: 1,
      doc: {
        defaultProductVatClass: "reduced",
        defaultColor: "#abcced",
        starterUnitsCreated: true,
        defaultTakeawayVatRate: null,
      },
      updated_at: metadata.updatedAt,
      updated_by: null,
    })]: {
      module: "menu",
      version: 1,
      revision: 1,
      doc: {
        defaultProductVatClass: "reduced",
        defaultColor: "#abcced",
        starterUnitsCreated: true,
        defaultTakeawayVatRate: null,
      },
      updated_at: metadata.updatedAt,
      updated_by: null,
    },
  });
  const result = documents.madridWithMenuSettings(captured, metadata.updatedAt);
  expect(Object.keys(result.tables)).toEqual(["settings"]);
  expect(captured).toEqual(before);
});

it("folds captured product units into nullable product columns without editing the capture", async () => {
  const documents = await import("./madrid-documents.js");
  expect(documents).toHaveProperty("madridWithProductUnits");
  const capture: import("./madrid-semantics.js").CanonicalMadridSemantics = {
    tables: {
      products: {
        columns: [{ name: "pricing_unit", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }],
        foreignKeys: [],
        rows: {
          parent: { id: "parent", pricing_unit: "weight" },
          variant: { id: "variant", pricing_unit: null },
        },
      },
      product_units: {
        columns: [{ name: "unit_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 }],
        foreignKeys: [
          {
            id: 0,
            seq: 0,
            table: "units",
            from: "unit_id",
            to: "id",
            on_update: "NO ACTION",
            on_delete: "RESTRICT",
            match: "NONE",
          },
        ],
        rows: { assignment: { product_id: "parent", unit_id: "kg" } },
      },
    },
  };
  const before = structuredClone(capture);
  const result = documents.madridWithProductUnits(capture);
  expect(result.tables).not.toHaveProperty("product_units");
  expect(result.tables.products).toEqual({
    columns: [{ name: "unit_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }],
    foreignKeys: [
      {
        id: 0,
        seq: 0,
        table: "units",
        from: "unit_id",
        to: "id",
        on_update: "NO ACTION",
        on_delete: "RESTRICT",
        match: "NONE",
      },
    ],
    rows: { parent: { id: "parent", unit_id: "kg" }, variant: { id: "variant", unit_id: null } },
  });
  expect(capture).toEqual(before);
  expect(() => documents.madridWithProductUnits(result)).toThrow("missing captured product units");
});

it("moves captured option defaults onto their own labels without changing the capture", () => {
  const captured: CanonicalMadridSemantics = {
    tables: {
      option_lists: {
        columns: [{ name: "default_label_id", type: "TEXT", notnull: 0, pk: 0, dflt_value: null }],
        foreignKeys: [],
        rows: {
          list: { id: "list", default_label_id: "b" },
          other: { id: "other", default_label_id: null },
        },
      },
      option_labels: {
        columns: [],
        foreignKeys: [],
        rows: {
          a: { id: "a", list_id: "list" },
          b: { id: "b", list_id: "list" },
          c: { id: "c", list_id: "other" },
        },
      },
    },
  };
  const before = structuredClone(captured);
  const result = documents.madridWithOptionDefaults(captured);
  expect(result.tables.option_lists!.columns).toEqual([]);
  expect(result.tables.option_lists!.rows).toEqual({
    list: { id: "list" },
    other: { id: "other" },
  });
  expect(result.tables.option_labels!.columns).toEqual([
    { name: "is_default", type: "INTEGER", notnull: 1, pk: 0, dflt_value: "false" },
  ]);
  expect(result.tables.option_labels!.rows).toEqual({
    a: { id: "a", list_id: "list", is_default: 0 },
    b: { id: "b", list_id: "list", is_default: 1 },
    c: { id: "c", list_id: "other", is_default: 0 },
  });
  expect(captured).toEqual(before);
});

it("moves the captured root name and three include states into the section columns without changing the capture", () => {
  const capture = {
    tables: {
      sections: {
        columns: [{ name: "internal_name", type: "TEXT", notnull: 1, pk: 0, dflt_value: null }],
        foreignKeys: [],
        rows: {
          root: { id: "root", role: "menu_root", internal_name: "Lunch" },
          plain: { id: "plain", role: "section", internal_name: "Starters" },
        },
      },
      section_members: {
        columns: [
          { name: "folder_overrides", type: "TEXT", notnull: 1, pk: 0, dflt_value: "'{}'" },
        ],
        foreignKeys: [],
        rows: {
          follow: { folder_overrides: {} },
          none: { folder_overrides: { image: null, color: null } },
          fixed: {
            folder_overrides: { names: { es: "Desserts" }, image: "photo.webp", color: "#112233" },
          },
        },
      },
    },
  };
  const actual = madridWithSectionColumns(capture);
  expect(actual.tables.sections!.rows).toEqual({
    root: { id: "root", role: "menu_root", internal_name: null },
    plain: { id: "plain", role: "section", internal_name: "Starters" },
  });
  expect(actual.tables.sections!.columns[0]!.notnull).toBe(0);
  expect(actual.tables.section_members!.rows).toEqual({
    follow: {
      folder_names: null,
      folder_image: null,
      folder_image_fixed: 0,
      folder_color: null,
      folder_color_fixed: 0,
    },
    none: {
      folder_names: null,
      folder_image: null,
      folder_image_fixed: 1,
      folder_color: null,
      folder_color_fixed: 1,
    },
    fixed: {
      folder_names: { es: "Desserts" },
      folder_image: "photo.webp",
      folder_image_fixed: 1,
      folder_color: "#112233",
      folder_color_fixed: 1,
    },
  });
  expect(actual.tables.section_members!.columns.map((column) => column.name)).toEqual([
    "folder_names",
    "folder_image",
    "folder_image_fixed",
    "folder_color",
    "folder_color_fixed",
  ]);
  expect(capture.tables.sections.rows.root.internal_name).toBe("Lunch");
  expect(capture.tables.section_members.rows.follow).toEqual({ folder_overrides: {} });
});
