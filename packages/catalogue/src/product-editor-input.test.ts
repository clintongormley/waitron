import { expect, it } from "vitest";
import { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";

const unitId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input: ProductEditorInput = {
  name: "Coffee",
  customerName: { en: "Coffee", es: "Café" },
  description: null,
  kitchenName: null,
  image: null,
  unitId,
  unitPrice: "9.00",
  available: false,
  vatClass: "zero",
  variants: [],
  categoryIds: [],
  primaryCategoryId: null,
  modifierIds: [],
  allergens: null,
  dietaryDeclarations: [],
};

it("preserves explicit zero tax, unavailable and unreviewed rather than choosing defaults", () => {
  expect(parseProductEditorInput(input)).toEqual(input);
});
it("parses an explicit null unit as null (the Each option)", () => {
  expect(parseProductEditorInput({ ...input, unitId: null }).unitId).toBeNull();
});
it("still rejects a non-null non-uuid unit", () => {
  expect(() => parseProductEditorInput({ ...input, unitId: "not-a-uuid" })).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "unitId" } }),
  );
});
it.each([undefined, "", "none", "invalid", false])(
  "rejects an unsupported or missing tax choice %j",
  (vatClass) => {
    expect(() => parseProductEditorInput({ ...input, vatClass })).toThrow(
      expect.objectContaining({ code: "product.invalid", params: { field: "vatClass" } }),
    );
  },
);
it.each([undefined, null, [], "product"])("rejects a malformed body %j", (body) => {
  expect(() => parseProductEditorInput(body)).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "product" } }),
  );
});
it.each([
  ["unitPrice", "10000000000"],
  ["unitPrice", "1.001"],
  ["unitPrice", "1e2"],
  ["unitPrice", "-1"],
  ["available", 0],
  ["name", 42],
  ["name", ""],
  ["name", "   "],
  ["customerName", { en: 42 }],
  ["customerName", "Coffee"],
  ["description", { en: 42 }],
  ["description", undefined],
  ["kitchenName", 42],
  ["image", false],
  ["categoryIds", [categoryId, categoryId.toUpperCase()]],
  ["modifierIds", [unitId, unitId]],
  ["primaryCategoryId", undefined],
] as const)("rejects malformed %s (%j)", (field, value) => {
  expect(() => parseProductEditorInput({ ...input, [field]: value })).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field } }),
  );
});
it("allows memberships with no reporting category but rejects a primary outside the set", () => {
  const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  // A non-empty set with a null reporting category is now accepted.
  expect(
    parseProductEditorInput({ ...input, categoryIds: [categoryId], primaryCategoryId: null })
      .primaryCategoryId,
  ).toBeNull();
  // A non-null primary must be one of the selected categories.
  expect(() =>
    parseProductEditorInput({ ...input, categoryIds: [categoryId], primaryCategoryId: other }),
  ).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "primaryCategoryId" } }),
  );
  // An empty set with a non-null primary stays invalid.
  expect(() =>
    parseProductEditorInput({ ...input, categoryIds: [], primaryCategoryId: categoryId }),
  ).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "primaryCategoryId" } }),
  );
  // A non-null primary that IS in the set is normalized to lower case.
  expect(
    parseProductEditorInput({
      ...input,
      categoryIds: [categoryId],
      primaryCategoryId: categoryId.toUpperCase(),
    }).primaryCategoryId,
  ).toBe(categoryId);
});
it("normalizes optional text and prices without mutating caller or copied allergen text", () => {
  const original = {
    ...input,
    description: { en: " " },
    kitchenName: " BAR ",
    unitPrice: "2.5",
    allergens: { milk: { presence: "contains", source: "Recorded supplier text" } },
  };
  expect(parseProductEditorInput(original)).toEqual({
    ...input,
    description: null,
    kitchenName: "BAR",
    unitPrice: "2.50",
    allergens: { milk: { presence: "contains" } },
  });
  expect(original.allergens.milk.source).toBe("Recorded supplier text");
});
it.each([
  [null, "variants.0"],
  [{ id: "bad", name: "Small", unitPrice: "2.00", available: true }, "variants.0.id"],
  [{ name: null, unitPrice: "2.00", available: true }, "variants.0.name"],
  [
    { name: "Small", customerName: { en: 42 }, unitPrice: "2.00", available: true },
    "variants.0.customerName",
  ],
  [
    { name: "Small", kitchenName: 42, unitPrice: "2.00", available: true },
    "variants.0.kitchenName",
  ],
  [{ name: "Small", image: 42, unitPrice: "2.00", available: true }, "variants.0.image"],
  [{ name: "Small", unitPrice: "2.001", available: true }, "variants.0.unitPrice"],
  [{ name: "Small", unitPrice: "2.00", available: "yes" }, "variants.0.available"],
] as const)("rejects a malformed variant %j", (variant, field) => {
  // A malformed variant is rejected while parsing that variant, before the min-two count check.
  expect(() => parseProductEditorInput({ ...input, variants: [variant] })).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field } }),
  );
});
it("refuses exactly one variant but accepts none or two, and parses each variant's own names", () => {
  const one = {
    name: "Small",
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: "2.00",
    available: true,
  };
  expect(() => parseProductEditorInput({ ...input, variants: [one] })).toThrow(
    expect.objectContaining({ code: "product.variant_count_invalid", params: { minimum: 2 } }),
  );
  expect(parseProductEditorInput({ ...input, variants: [] }).variants).toEqual([]);
  const parsed = parseProductEditorInput({
    ...input,
    variants: [
      {
        name: " Small ",
        customerName: { en: "Small cup" },
        kitchenName: " SM ",
        image: "s.png",
        unitPrice: "2",
        available: true,
      },
      {
        name: "Large",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.00",
        available: false,
      },
    ],
  });
  expect(parsed.variants).toEqual([
    {
      name: "Small",
      customerName: { en: "Small cup" },
      kitchenName: "SM",
      image: "s.png",
      unitPrice: "2.00",
      available: true,
    },
    {
      name: "Large",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "3.00",
      available: false,
    },
  ]);
});
it("treats a blank customer name as absent on the product and its variants", () => {
  const parsed = parseProductEditorInput({ ...input, customerName: { en: "  " } });
  expect(parsed.customerName).toBeNull();
});
it("rejects a repeated variant ID even with a different case", () => {
  const variant = { id: unitId, name: "Small", unitPrice: "2.00", available: true };
  expect(() =>
    parseProductEditorInput({
      ...input,
      variants: [variant, { ...variant, id: unitId.toUpperCase() }],
    }),
  ).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "variants.1.id" } }),
  );
});
