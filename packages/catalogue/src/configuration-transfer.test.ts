import { describe, expect, it } from "vitest";
import { validateCatalogueConfiguration } from "./configuration-transfer.js";

function refusal(code: string, name: string) {
  return expect.objectContaining({ code, params: { field: "name", name } });
}

describe("validateCatalogueConfiguration: category names", () => {
  it("refuses two top-level categories sharing a name, with or without a details row", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "c1", name: "Bebidas" },
          { id: "c2", name: " bebidas " },
        ],
        category_details: [{ category_id: "c2", parent_id: null }],
      }),
    ).toThrowError(refusal("category.name_taken", "bebidas"));
  });

  it("refuses two categories with one parent sharing a name", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "top", name: "Carta" },
          { id: "c1", name: "Postres" },
          { id: "c2", name: "POSTRES" },
        ],
        category_details: [
          { category_id: "c1", parent_id: "top" },
          { category_id: "c2", parent_id: "top" },
        ],
      }),
    ).toThrowError(refusal("category.name_taken", "POSTRES"));
  });

  it("accepts one name under different parents, and a parent sharing its child's name", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [
          { id: "lunch", name: "Lunch" },
          { id: "dinner", name: "Dinner" },
          { id: "c1", name: "Mains" },
          { id: "c2", name: "Mains" },
          { id: "c3", name: "Dinner" },
        ],
        category_details: [
          { category_id: "c1", parent_id: "lunch" },
          { category_id: "c2", parent_id: "dinner" },
          { category_id: "c3", parent_id: "dinner" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("validateCatalogueConfiguration: product names", () => {
  it("refuses an Active variant of an Active product named like another Active product", () => {
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Café Solo", active: 1, parent_id: null },
          { id: "p2", name: "Café", active: 1, parent_id: null },
          { id: "v1", name: " café solo ", active: 1, parent_id: "p2" },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "café solo"));
  });

  it("counts a product or variant with no Active flag as Active, as the column's default does", () => {
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Agua", parent_id: null },
          { id: "p2", name: "agua", parent_id: null },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "agua"));
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Café", parent_id: null },
          { id: "v1", name: "Café Solo", parent_id: "p1" },
          { id: "p2", name: "café solo", active: 1, parent_id: null },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "café solo"));
  });

  it.each([true, false, "1", "0", null, 2])(
    "refuses a product whose Active flag is %j, which no export writes",
    (active) => {
      expect(() =>
        validateCatalogueConfiguration({
          products: [{ id: "p1", name: "Agua", active, parent_id: null }],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "products.active" },
        }),
      );
    },
  );

  it("does not count an Inactive product, nor a variant of one, nor an Inactive variant", () => {
    expect(() =>
      validateCatalogueConfiguration({
        products: [
          { id: "p1", name: "Agua", active: 1, parent_id: null },
          { id: "p2", name: "Agua", active: 0, parent_id: null },
          { id: "p3", name: "Zumo", active: 0, parent_id: null },
          { id: "v1", name: "Agua", active: 1, parent_id: "p3" },
          { id: "p4", name: "Vino", active: 1, parent_id: null },
          { id: "v2", name: "Agua", active: 0, parent_id: "p4" },
        ],
      }),
    ).not.toThrow();
  });

  it("does not compare a category's name with a product's", () => {
    expect(() =>
      validateCatalogueConfiguration({
        categories: [{ id: "c1", name: "Agua" }],
        products: [{ id: "p1", name: "Agua", active: 1, parent_id: null }],
      }),
    ).not.toThrow();
  });

  it.each([7, null, undefined])("refuses a category or product whose name is %j", (name) => {
    const row = name === undefined ? {} : { name };
    expect(() =>
      validateCatalogueConfiguration({ categories: [{ id: "c1", ...row }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "categories.name" },
      }),
    );
    expect(() =>
      validateCatalogueConfiguration({
        products: [{ id: "p1", ...row, active: 0, parent_id: null }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "products.name" },
      }),
    );
  });

  it("accepts a bundle without the tables", () => {
    expect(() => validateCatalogueConfiguration({})).not.toThrow();
  });
});

describe("validateCatalogueConfiguration: colours", () => {
  const coloured = (table: string, color: unknown) =>
    table === "products"
      ? { products: [{ id: "p1", name: "Agua", active: 1, parent_id: null, color }] }
      : { [table]: [{ color }] };

  it.each(["products", "category_details", "sections"])(
    "refuses a %s colour that is not lowercase #rrggbb",
    (table) => {
      for (const color of ["#256bb1;position:fixed;inset:0", "#256BB1", "red", "", 7]) {
        expect(() => validateCatalogueConfiguration(coloured(table, color))).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `${table}.color` },
          }),
        );
      }
    },
  );

  it.each(["products", "category_details", "sections"])(
    "accepts a %s colour that is lowercase #rrggbb, null or absent",
    (table) => {
      for (const color of ["#256bb1", null, undefined]) {
        expect(() => validateCatalogueConfiguration(coloured(table, color))).not.toThrow();
      }
    },
  );
});

describe("validateCatalogueConfiguration: menu display settings", () => {
  it.each([
    ["handheld_columns", 7],
    ["till_columns", 5],
    ["till_columns", "8"],
    ["handheld_tiles", "pictures"],
    ["till_order", "first"],
  ])("refuses a menu_details row whose %s is %j", (column, value) => {
    expect(() =>
      validateCatalogueConfiguration({ menu_details: [{ menu_id: "m1", [column]: value }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: `menu_details.${column}` },
      }),
    );
  });

  it("accepts a row holding all six at their defaults, and a row with none of them", () => {
    expect(() =>
      validateCatalogueConfiguration({
        menu_details: [
          {
            menu_id: "m1",
            handheld_columns: 3,
            handheld_tiles: "colours",
            handheld_order: "home_first",
            till_columns: 6,
            till_tiles: "colours",
            till_order: "home_first",
          },
          { menu_id: "m2" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("validateCatalogueConfiguration: many siblings", () => {
  it("judges a hundred thousand categories under one parent", () => {
    const categories = Array.from({ length: 100_000 }, (_, index) => ({
      id: `c${index}`,
      name: `Category ${index}`,
    }));
    const started = performance.now();
    expect(() => validateCatalogueConfiguration({ categories })).not.toThrow();
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("validateCatalogueConfiguration: new-product VAT default", () => {
  it.each(["general", "reduced", "super_reduced", "zero"])("accepts the %s default", (value) => {
    expect(() =>
      validateCatalogueConfiguration({
        catalogue_settings: [{ id: 1, default_product_vat_class: value }],
      }),
    ).not.toThrow();
  });
  it.each([null, undefined, "", "unknown", 10, ["reduced"]])(
    "refuses %j as an imported default",
    (value) => {
      expect(() =>
        validateCatalogueConfiguration({
          catalogue_settings: [{ id: 1, default_product_vat_class: value }],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "catalogue_settings.default_product_vat_class" },
        }),
      );
    },
  );
});

describe("validateCatalogueConfiguration: include folders", () => {
  const sections = [
    { id: "lunch-root", role: "menu_root" },
    { id: "drinks-root", role: "menu_root" },
    { id: "home", role: "home_layout" },
    { id: "beer", role: "section" },
  ];
  const include = { id: "m1", section_id: "lunch-root", child_section_id: "drinks-root" };
  const bundle = (member: Record<string, unknown>) => ({
    sections,
    section_members: [{ ...include, ...member }],
  });
  const refusedAs = (field: string) =>
    expect.objectContaining({ code: "setup.request_invalid", params: { field } });

  it("refuses imported folder overrides that are not an object or carry a bad colour", () => {
    for (const folder_overrides of [
      "not json",
      "[]",
      '"Bar"',
      "5",
      "null",
      { names: { en: "Bar" } },
      '{"color":"#ABCDEF"}',
      '{"color":5}',
      '{"image":5}',
      '{"image":true}',
      '{"names":"Bar"}',
      '{"names":{"en":7}}',
      '{"names":["Bar"]}',
      '{"names":{"not a language":"Bar"}}',
      '{"names":{"EN":"Bar"}}',
      '{"names":{"en":"Bar"},"note":"x"}',
      '{"names":{}}',
      '{"names":{},"color":null}',
      null,
      7,
    ])
      expect(
        () => validateCatalogueConfiguration(bundle({ folder_overrides })),
        JSON.stringify(folder_overrides),
      ).toThrowError(refusedAs("section_members.folder_overrides"));
  });

  it("accepts a well-formed folder on an include, and a row without the columns", () => {
    for (const member of [
      {
        show_as_folder: 0,
        folder_overrides: '{"names":{"en":"Bar","es":""},"image":"bar.jpg","color":"#112233"}',
      },
      { show_as_folder: 1, folder_overrides: '{"image":null,"color":null}' },
      { show_as_folder: false, folder_overrides: "{}" },
      { show_as_folder: true },
      {},
    ])
      expect(
        () => validateCatalogueConfiguration(bundle(member)),
        JSON.stringify(member),
      ).not.toThrow();
  });

  it.each(["yes", 2, null, "1"])("refuses a show_as_folder of %j", (show_as_folder) => {
    expect(() => validateCatalogueConfiguration(bundle({ show_as_folder }))).toThrowError(
      refusedAs("section_members.show_as_folder"),
    );
  });

  it("refuses a folder setting on a member that is not an include, and accepts the defaults there", () => {
    const placements = [
      { section_id: "lunch-root", child_section_id: null, product_id: "p1" },
      { section_id: "lunch-root", child_section_id: "beer" },
      { section_id: "home", child_section_id: "drinks-root" },
      { section_id: "lunch-root", child_section_id: "not-in-bundle" },
      { section_id: "not-in-bundle", child_section_id: "drinks-root" },
      { section_id: "home", child_section_id: null, missing_name: "Gone" },
    ];
    for (const placement of placements) {
      for (const [folder, field] of [
        [{ show_as_folder: 0 }, "show_as_folder"],
        [{ folder_overrides: '{"color":null}' }, "folder_overrides"],
      ] as const)
        expect(
          () => validateCatalogueConfiguration(bundle({ ...placement, ...folder })),
          JSON.stringify({ ...placement, ...folder }),
        ).toThrowError(refusedAs(`section_members.${field}`));
      for (const folder of [{}, { show_as_folder: 1, folder_overrides: "{}" }])
        expect(() =>
          validateCatalogueConfiguration(bundle({ ...placement, ...folder })),
        ).not.toThrow();
    }
  });
});
