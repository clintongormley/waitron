import { describe, expect, it } from "vitest";
import { validateMenuConfiguration } from "./configuration-transfer.js";

function refusal(code: string, name: string) {
  return expect.objectContaining({ code, params: { field: "name", name } });
}

describe("validateMenuConfiguration: category names", () => {
  it("refuses two top-level categories sharing a name, with an explicit or default parent", () => {
    expect(() =>
      validateMenuConfiguration({
        categories: [
          { id: "c1", name: "ES drinks" },
          { id: "c2", name: " es drinks ", parent_id: null },
        ],
      }),
    ).toThrowError(refusal("category.name_taken", "es drinks"));
  });

  it("refuses two categories with one parent sharing a name", () => {
    expect(() =>
      validateMenuConfiguration({
        categories: [
          { id: "top", name: "Menu" },
          { id: "c1", name: "Desserts", parent_id: "top" },
          { id: "c2", name: "DESSERTS", parent_id: "top" },
        ],
      }),
    ).toThrowError(refusal("category.name_taken", "DESSERTS"));
  });

  it("accepts one name under different parents, and a parent sharing its child's name", () => {
    expect(() =>
      validateMenuConfiguration({
        categories: [
          { id: "lunch", name: "Lunch" },
          { id: "dinner", name: "Dinner" },
          { id: "c1", name: "Mains", parent_id: "lunch" },
          { id: "c2", name: "Mains", parent_id: "dinner" },
          { id: "c3", name: "Dinner", parent_id: "dinner" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("relative variant import names", () => {
  it("accepts Single under Seagrams Gin and London Gin, and as a product", () => {
    expect(() =>
      validateMenuConfiguration({
        products: [
          { id: "s", name: "Seagrams Gin", active: 1, parent_id: null },
          { id: "l", name: "London Gin", active: 1, parent_id: null },
          { id: "p", name: "Single", active: 1, parent_id: null },
          { id: "sv", name: "Single", active: 1, parent_id: "s" },
          { id: "lv", name: "Single", active: 1, parent_id: "l" },
        ],
      }),
    ).not.toThrow();
  });
  it("refuses Single twice under Seagrams Gin with omitted active flags", () => {
    expect(() =>
      validateMenuConfiguration({
        products: [
          { id: "s", name: "Seagrams Gin", parent_id: null },
          { id: "v1", name: "Single", parent_id: "s" },
          { id: "v2", name: " single ", parent_id: "s" },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "single"));
  });
});

describe("validateMenuConfiguration: product names", () => {
  it("accepts an Active variant named like another Active product", () => {
    expect(() =>
      validateMenuConfiguration({
        products: [
          { id: "p1", name: "Café Solo", active: 1, parent_id: null },
          { id: "p2", name: "Café", active: 1, parent_id: null },
          { id: "v1", name: " café solo ", active: 1, parent_id: "p2" },
        ],
      }),
    ).not.toThrow();
  });

  it("counts a product or variant with no Active flag as Active, as the column's default does", () => {
    expect(() =>
      validateMenuConfiguration({
        products: [
          { id: "p1", name: "Water", parent_id: null },
          { id: "p2", name: "water", parent_id: null },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "water"));
    expect(() =>
      validateMenuConfiguration({
        products: [
          { id: "p1", name: "Café", parent_id: null },
          { id: "v1", name: "Café Solo", parent_id: "p1" },
          { id: "v2", name: "café solo", active: 1, parent_id: "p1" },
        ],
      }),
    ).toThrowError(refusal("product.name_taken", "café solo"));
  });

  it.each([true, false, "1", "0", null, 2])(
    "refuses a product whose Active flag is %j, which no export writes",
    (active) => {
      expect(() =>
        validateMenuConfiguration({
          products: [{ id: "p1", name: "Water", active, parent_id: null }],
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
      validateMenuConfiguration({
        products: [
          { id: "p1", name: "Water", active: 1, parent_id: null },
          { id: "p2", name: "Water", active: 0, parent_id: null },
          { id: "p3", name: "Juice", active: 0, parent_id: null },
          { id: "v1", name: "Water", active: 1, parent_id: "p3" },
          { id: "p4", name: "Wine", active: 1, parent_id: null },
          { id: "v2", name: "Water", active: 0, parent_id: "p4" },
        ],
      }),
    ).not.toThrow();
  });

  it("does not compare a category's name with a product's", () => {
    expect(() =>
      validateMenuConfiguration({
        categories: [{ id: "c1", name: "Water" }],
        products: [{ id: "p1", name: "Water", active: 1, parent_id: null }],
      }),
    ).not.toThrow();
  });

  it.each([7, null, undefined])("refuses a category or product whose name is %j", (name) => {
    const row = name === undefined ? {} : { name };
    expect(() => validateMenuConfiguration({ categories: [{ id: "c1", ...row }] })).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "categories.name" },
      }),
    );
    expect(() =>
      validateMenuConfiguration({
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
    expect(() => validateMenuConfiguration({})).not.toThrow();
  });
});

describe("validateMenuConfiguration: colours", () => {
  const coloured = (table: string, color: unknown) =>
    table === "products"
      ? { products: [{ id: "p1", name: "Water", active: 1, parent_id: null, color }] }
      : {
          [table]: [
            {
              name: "Category",
              color,
              ...(table === "sections" ? { internal_name: "Section" } : {}),
            },
          ],
        };

  it.each(["products", "categories", "sections"])(
    "refuses a %s colour that is not lowercase #rrggbb",
    (table) => {
      for (const color of ["#256bb1;position:fixed;inset:0", "#256BB1", "red", "", 7]) {
        expect(() => validateMenuConfiguration(coloured(table, color))).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `${table}.color` },
          }),
        );
      }
    },
  );

  it.each(["products", "categories", "sections"])(
    "accepts a %s colour that is lowercase #rrggbb, null or absent",
    (table) => {
      for (const color of ["#256bb1", null, undefined]) {
        expect(() => validateMenuConfiguration(coloured(table, color))).not.toThrow();
      }
    },
  );
});

describe("validateMenuConfiguration: a variant's category and colour", () => {
  const parent = { id: "gin", name: "Gin", category_id: "spirits", color: "#256bb1" };
  const withVariant = (variant: Record<string, unknown>) => ({
    products: [parent, { id: "single", name: "Single", parent_id: "gin", ...variant }],
  });

  it.each([
    ["category_id", "spirits"],
    ["color", "#256bb1"],
  ])("refuses a variant that stores its own %s", (column, value) => {
    expect(() => validateMenuConfiguration(withVariant({ [column]: value }))).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: `products.${column}` },
      }),
    );
  });

  it("accepts a variant storing neither, and a product with its own category and colour", () => {
    expect(() =>
      validateMenuConfiguration(withVariant({ category_id: null, color: null })),
    ).not.toThrow();
    expect(() => validateMenuConfiguration(withVariant({}))).not.toThrow();
  });
});

describe("validateMenuConfiguration: menu display settings", () => {
  it.each([
    ["handheld_columns", 4],
    ["till_columns", 3],
    ["till_columns", "8"],
    ["handheld_tiles", "pictures"],
    ["till_order", "first"],
  ])("refuses a menus row whose %s is %j", (column, value) => {
    expect(() =>
      validateMenuConfiguration({ menus: [{ id: "m1", [column]: value }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: `menus.${column}` },
      }),
    );
  });

  it("accepts a row holding all six at their defaults, and a row with none of them", () => {
    expect(() =>
      validateMenuConfiguration({
        menus: [
          {
            id: "m1",
            handheld_columns: 3,
            handheld_tiles: "colours",
            handheld_order: "home_first",
            till_columns: 6,
            till_tiles: "colours",
            till_order: "home_first",
          },
          { id: "m2" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("validateMenuConfiguration: many siblings", () => {
  it("judges a hundred thousand categories under one parent", () => {
    const categories = Array.from({ length: 100_000 }, (_, index) => ({
      id: `c${index}`,
      name: `Category ${index}`,
    }));
    const started = performance.now();
    expect(() => validateMenuConfiguration({ categories })).not.toThrow();
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("validateMenuConfiguration: include folders", () => {
  const sections = [
    { id: "lunch-root", role: "menu_root" },
    { id: "drinks-root", role: "menu_root" },
    { id: "home", role: "home_layout", internal_name: "Home" },
    { id: "beer", role: "section", internal_name: "Beer" },
  ];
  const include = { id: "m1", section_id: "lunch-root", child_section_id: "drinks-root" };
  const bundle = (member: Record<string, unknown>) => ({
    sections,
    section_members: [{ ...include, ...member }],
  });
  const refusedAs = (field: string) =>
    expect.objectContaining({ code: "setup.request_invalid", params: { field } });

  it.each([
    ...[
      "not json",
      "[]",
      '"Bar"',
      "5",
      "{}",
      '{"en":7}',
      '{"not a language":"Bar"}',
      '{"EN":"Bar"}',
      { en: "Bar" },
      7,
    ].map((value): [string, unknown] => ["folder_names", value]),
    ...[2, "1", true, null].flatMap((value): [string, unknown][] => [
      ["folder_image_fixed", value],
      ["folder_color_fixed", value],
    ]),
    ["folder_image", "bad.jpg"],
    ["folder_image", 5],
    ["folder_color", "#ABCDEF"],
    ["folder_color", 5],
  ])("refuses malformed imported %s of %j", (field, value) => {
    expect(() =>
      validateMenuConfiguration(
        bundle({
          [field as string]: value,
          folder_image_fixed: field === "folder_image_fixed" ? value : 1,
          folder_color_fixed: field === "folder_color_fixed" ? value : 1,
        }),
      ),
    ).toThrowError(refusedAs(`section_members.${field}`));
  });

  it.each(["image", "color"])("refuses a fixed folder %s without its flag", (field) => {
    expect(() =>
      validateMenuConfiguration(
        bundle({ [`folder_${field}`]: field === "image" ? `${"a".repeat(64)}.webp` : "#112233" }),
      ),
    ).toThrowError(refusedAs(`section_members.folder_${field}`));
  });

  it("accepts following, fixed-none and fixed-value folders on an include", () => {
    for (const member of [
      {
        show_as_folder: 0,
        folder_names: '{"en":"Bar","es":""}',
        folder_image: `${"a".repeat(64)}.webp`,
        folder_image_fixed: 1,
        folder_color: "#112233",
        folder_color_fixed: 1,
      },
      {
        show_as_folder: 1,
        folder_image: null,
        folder_image_fixed: 1,
        folder_color: null,
        folder_color_fixed: 1,
      },
      { show_as_folder: false, folder_names: null },
      { show_as_folder: true },
      {},
    ])
      expect(() => validateMenuConfiguration(bundle(member)), JSON.stringify(member)).not.toThrow();
  });

  it.each(['{"en":" Bar"}', '{"en":"Bar "}', '{"en":"Bar","es":"\\tBarra"}'])(
    "refuses an imported folder name a save would trim: %s",
    (folder_names) => {
      expect(() => validateMenuConfiguration(bundle({ folder_names }))).toThrowError(
        refusedAs("section_members.folder_names"),
      );
    },
  );

  it("refuses an imported folder name too long for a save", () => {
    const folder_names = JSON.stringify({ en: "é".repeat(2049) });
    expect(() => validateMenuConfiguration(bundle({ folder_names }))).toThrowError(
      refusedAs("section_members.folder_names"),
    );
  });

  it.each(["yes", 2, null, "1"])("refuses a show_as_folder of %j", (show_as_folder) => {
    expect(() => validateMenuConfiguration(bundle({ show_as_folder }))).toThrowError(
      refusedAs("section_members.show_as_folder"),
    );
  });

  it("refuses folder settings on non-includes and accepts their defaults", () => {
    for (const placement of [
      { section_id: "lunch-root", child_section_id: null, product_id: "p1" },
      { section_id: "lunch-root", child_section_id: "beer" },
      { section_id: "home", child_section_id: "drinks-root" },
      { section_id: "lunch-root", child_section_id: "not-in-bundle" },
      { section_id: "not-in-bundle", child_section_id: "drinks-root" },
      { section_id: "home", child_section_id: null, missing_name: "Gone" },
    ]) {
      for (const [folder, field] of [
        [{ show_as_folder: 0 }, "show_as_folder"],
        [{ folder_color_fixed: 1 }, "folder_color_fixed"],
        [{ folder_image_fixed: 1 }, "folder_image_fixed"],
        [{ folder_names: '{"en":"Bar"}' }, "folder_names"],
      ] as const)
        expect(() => validateMenuConfiguration(bundle({ ...placement, ...folder }))).toThrowError(
          refusedAs(`section_members.${field}`),
        );
      for (const folder of [
        {},
        { show_as_folder: 1, folder_names: null, folder_image_fixed: 0, folder_color_fixed: 0 },
      ])
        expect(() => validateMenuConfiguration(bundle({ ...placement, ...folder }))).not.toThrow();
    }
  });

  it.each([
    ["menu_root", "Duplicate"],
    ["section", null],
    ["home_layout", null],
  ])("refuses an imported %s with stored name %j", (role, internal_name) => {
    expect(() =>
      validateMenuConfiguration({ sections: [{ id: "bad", role, internal_name }] }),
    ).toThrowError(refusedAs("sections.internal_name"));
  });
});

describe("validateMenuConfiguration: Inactive products stay off menus", () => {
  const sections = [
    { id: "lunch-root", role: "menu_root" },
    { id: "home", role: "home_layout", internal_name: "Home" },
    { id: "beer", role: "section", internal_name: "Beer" },
  ];
  const bundle = (active: 0 | 1, variantActive: 0 | 1, sectionId: string) => ({
    sections,
    products: [
      { id: "gin", name: "Gin", active, parent_id: null },
      { id: "single", name: "Single", active: variantActive, parent_id: "gin" },
    ],
    section_members: [
      { id: "m1", section_id: sectionId, child_section_id: null, product_id: "gin" },
    ],
    menu_item_variant_overrides: [{ menu_item_id: "i1", product_id: "gin", variant_id: "single" }],
  });
  const refusedAs = (field: string) =>
    expect.objectContaining({ code: "setup.request_invalid", params: { field } });

  it.each(["lunch-root", "beer", "home"])(
    "refuses an Inactive product placed in %s",
    (sectionId) => {
      expect(() => validateMenuConfiguration(bundle(0, 1, sectionId))).toThrowError(
        refusedAs("section_members.product_id"),
      );
    },
  );

  it("refuses a menu price for an Inactive variant", () => {
    expect(() => validateMenuConfiguration(bundle(1, 0, "beer"))).toThrowError(
      refusedAs("menu_item_variant_overrides.variant_id"),
    );
  });

  it("accepts the same rows with the product and variant Active, or with no Active flag", () => {
    for (const sectionId of ["lunch-root", "beer", "home"])
      expect(() => validateMenuConfiguration(bundle(1, 1, sectionId))).not.toThrow();
    const flagless = bundle(1, 1, "beer");
    expect(() =>
      validateMenuConfiguration({
        ...flagless,
        products: flagless.products.map((row) => ({ ...row, active: undefined })),
      }),
    ).not.toThrow();
  });
});

describe("explicit unit staff identity on configuration import", () => {
  const unit = {
    id: "weight",
    staff_name: "Kilogram",
    staff_abbreviation: "kg",
    name: {},
    abbreviation: {},
    precision: 3,
    hardware_unit: "kg",
    seed_key: "kg",
  };
  it("accepts blank translation maps without mutating retained disabled translations", () => {
    const rows = {
      units: [unit, { ...unit, id: "other", name: { es: "Peso" }, abbreviation: { es: "p" } }],
    };
    const before = structuredClone(rows);
    expect(() => validateMenuConfiguration(rows)).not.toThrow();
    expect(rows).toEqual(before);
  });
  it("validates the raw JSON strings carried by a configuration export without rewriting them", () => {
    const row = { ...unit, name: '{"de":"Gewicht","en":"Weight"}', abbreviation: "{}" };
    const before = structuredClone(row);
    expect(() => validateMenuConfiguration({ units: [row] })).not.toThrow();
    expect(row).toEqual(before);
  });
  for (const field of ["staff_name", "staff_abbreviation"] as const) {
    it.each([undefined, null, "", "  ", 7, "é".repeat(2049)])(
      `refuses imported ${field} %j`,
      (value) => {
        expect(() =>
          validateMenuConfiguration({ units: [{ ...unit, [field]: value }] }),
        ).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `units.${field}` },
          }),
        );
      },
    );
  }
  for (const field of ["name", "abbreviation"] as const) {
    it.each([null, [], { en: 7 }, { EN: "Weight" }])(
      `refuses malformed imported ${field} %j`,
      (value) => {
        expect(() =>
          validateMenuConfiguration({ units: [{ ...unit, [field]: value }] }),
        ).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `units.${field}` },
          }),
        );
      },
    );
  }
  it.each([-1, 4, 1.5, "3"])("refuses imported precision %j", (precision) => {
    expect(() => validateMenuConfiguration({ units: [{ ...unit, precision }] })).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "units.precision" },
      }),
    );
  });
});

describe("imported option and extras lists", () => {
  it.each([null, true, false, "1", 2])("refuses an imported default flag of %j", (is_default) => {
    expect(() =>
      validateMenuConfiguration({ option_labels: [{ name: "Choice", list_id: "a", is_default }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "option_labels.is_default" },
      }),
    );
  });
  it.each([0, -1, "1"])("refuses an imported maximum of %j", (max_picks) => {
    expect(() =>
      validateMenuConfiguration({ extra_lists: [{ name: "Sides", min_picks: 0, max_picks }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "extra_lists.max_picks" },
      }),
    );
    for (const max_picks of [undefined, null, 1])
      expect(() =>
        validateMenuConfiguration({ extra_lists: [{ name: "Sides", min_picks: 0, max_picks }] }),
      ).not.toThrow();
  });
  it.each(["option_lists", "option_labels", "extra_lists"])(
    "refuses an imported blank name in %s",
    (table) => {
      for (const name of ["", "  ", null, 42])
        expect(() => validateMenuConfiguration({ [table]: [{ name }] })).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `${table}.name` },
          }),
        );
      expect(() => validateMenuConfiguration({ [table]: [{ name: "Choice" }] })).not.toThrow();
    },
  );
  it("refuses two preselected labels in one imported list", () => {
    const label = { name: "Choice", list_id: "a", is_default: 1 };
    expect(() =>
      validateMenuConfiguration({ option_labels: [label, { ...label, name: "Other" }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "option_labels.is_default" },
      }),
    );
    expect(() =>
      validateMenuConfiguration({
        option_labels: [
          label,
          { ...label, list_id: "b" },
          { ...label, is_default: 0 },
          { name: "No default", list_id: "a" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("set menus in a configuration bundle", () => {
  const setMenu = { id: "set", kind: "set_menu", set_price: 1400, set_vat_class: "reduced" };
  const menu = { id: "ordinary", kind: "menu" };
  const invalid = (field: string) =>
    expect.objectContaining({ code: "setup.request_invalid", params: { field } });

  it.each([1_000_001, -1, 1400.5, "1400", null])("refuses a set-menu price of %j", (setPrice) => {
    expect(() =>
      validateMenuConfiguration({ menus: [{ ...setMenu, set_price: setPrice }] }),
    ).toThrow(invalid("menus.set_price"));
  });

  it.each([0, 1_000_000])("accepts a whole-cent set-menu price of %i", (setPrice) => {
    expect(() =>
      validateMenuConfiguration({ menus: [menu, { ...setMenu, set_price: setPrice }] }),
    ).not.toThrow();
  });

  it.each([
    ["menu_items.gross_price", { gross_price: 1_000_001 }, []],
    [
      "menu_item_variant_overrides.price",
      { gross_price: null },
      [{ menu_item_id: "dish", variant_id: "large", price: 1_000_001 }],
    ],
  ] as const)("refuses an over-limit surcharge at %s", (field, values, overrides) => {
    expect(() =>
      validateMenuConfiguration({
        menus: [setMenu],
        menu_items: [{ id: "dish", menu_id: "set", ...values }],
        menu_item_variant_overrides: [...overrides],
      }),
    ).toThrow(invalid(field));
  });

  it("accepts null and boundary set-menu surcharges and higher ordinary prices", () => {
    expect(() =>
      validateMenuConfiguration({
        menus: [setMenu, menu],
        menu_items: [
          { id: "dish", menu_id: "set", gross_price: null },
          { id: "fish", menu_id: "set", gross_price: 1_000_000 },
          { id: "ordinary-item", menu_id: "ordinary", gross_price: 1_000_001 },
        ],
        menu_item_variant_overrides: [
          { menu_item_id: "dish", variant_id: "large", price: 1_000_000 },
          { menu_item_id: "ordinary-item", variant_id: "small", price: 1_000_001 },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ["set_menu_lines", "menu_id", "ordinary"],
    ["set_menu_dish_courses", "menu_item_id", "ordinary-item"],
    ["set_menu_variant_exclusions", "menu_item_id", "ordinary-item"],
  ])("refuses %s attached to an ordinary menu", (table, column, id) => {
    expect(() =>
      validateMenuConfiguration({
        menus: [menu, setMenu],
        menu_items: [{ id: "ordinary-item", menu_id: "ordinary" }],
        [table]: [{ [column]: id }],
      }),
    ).toThrow(invalid(`${table}.${column}`));
  });
});
