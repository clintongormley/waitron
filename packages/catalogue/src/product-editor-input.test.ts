import { expect, it } from "vitest";
import { parseProductEditorInput, type ProductEditorInput } from "./product-editor-input.js";

const unitId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const extrasListId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const optionsListId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const input: ProductEditorInput = {
  name: "Coffee",
  customerName: { en: "Coffee", es: "Café" },
  soldAlone: true,
  description: null,
  kitchenName: null,
  image: null,
  unitId,
  unitPrice: "9.00",
  // Active and Available carry DIFFERENT values, so a parser that reads one into the other fails.
  active: true,
  available: false,
  vatClass: "zero",
  variants: [],
  categoryIds: [],
  primaryCategoryId: null,
  modifiers: [],
  allergens: null,
  dietaryDeclarations: [],
};

it("preserves explicit zero tax, unavailable and unreviewed rather than choosing defaults", () => {
  expect(parseProductEditorInput(input)).toEqual(input);
});
it("carries soldAlone through but requires it in the body, exactly like available", () => {
  expect(parseProductEditorInput({ ...input, soldAlone: false }).soldAlone).toBe(false);
  // An absent soldAlone is refused rather than defaulted, mirroring the available-absent case below.
  const noFlag: Record<string, unknown> = { ...input };
  delete noFlag.soldAlone;
  expect(() => parseProductEditorInput(noFlag)).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "soldAlone" } }),
  );
});
it("refuses an absent available, the sibling required boolean", () => {
  const noAvailable: Record<string, unknown> = { ...input };
  delete noAvailable.available;
  expect(() => parseProductEditorInput(noAvailable)).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "available" } }),
  );
});
it("carries active through apart from available, and requires it in the body", () => {
  const parsed = parseProductEditorInput({ ...input, active: false, available: true });
  expect({ active: parsed.active, available: parsed.available }).toEqual({
    active: false,
    available: true,
  });
  const noActive: Record<string, unknown> = { ...input };
  delete noActive.active;
  expect(() => parseProductEditorInput(noActive)).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "active" } }),
  );
  expect(() => parseProductEditorInput({ ...input, active: "yes" })).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "active" } }),
  );
});
it("rejects a non-boolean soldAlone", () => {
  expect(() => parseProductEditorInput({ ...input, soldAlone: 1 })).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "soldAlone" } }),
  );
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

// ── The product's ordered attachment list (`modifiers`) ────────────────────────────────────────
//
// It replaces the flat `modifierIds` the body used to carry: each entry names one list and which
// KIND of list it is, and the array's order is the order a diner is offered them.
//
// The field names below are INDEXED (`modifiers.0.kind`), where the plan's Task 6 Step 1(b) wrote a
// bare `modifiers`. Two reasons to diverge, both checkable: the `variants` screen in this same file
// already refuses per entry (`variants.0.id`, product-editor-input.ts), and the refusals thrown one
// layer down when the ids are checked against the stored lists carry the indexed form too
// (`assertRefsExist`, product-modifiers.ts:113 and :127). A bare `modifiers` here would hand the
// editor two different field shapes for one bad input, depending on which layer caught it. The
// whole-array refusals (not an array, absent) stay bare, because no entry is at fault.

it("keeps a mixed extras-and-options list in the order the body sent, and lower-cases the ids", () => {
  const sent = [
    { kind: "options", id: optionsListId.toUpperCase() },
    { kind: "extras", id: extrasListId },
    { kind: "options", id: extrasListId },
  ];
  expect(parseProductEditorInput({ ...input, modifiers: sent }).modifiers).toEqual([
    { kind: "options", id: optionsListId },
    { kind: "extras", id: extrasListId },
    // The same id under the OTHER kind is a different list, so it is not a duplicate.
    { kind: "options", id: extrasListId },
  ]);
});

it.each([
  ["a non-array", "modifiers", "nope"],
  ["an absent list", "modifiers", undefined],
  ["a non-object entry", "modifiers.0", ["nope"]],
  ["a null entry", "modifiers.0", [null]],
  ["an unknown kind", "modifiers.0.kind", [{ kind: "sauces", id: extrasListId }]],
  ["a missing kind", "modifiers.0.kind", [{ id: extrasListId }]],
  ["a non-uuid id", "modifiers.0.id", [{ kind: "extras", id: "not-a-uuid" }]],
  ["a missing id", "modifiers.0.id", [{ kind: "extras" }]],
  [
    "the same list twice under one kind",
    "modifiers.1.id",
    [
      { kind: "extras", id: extrasListId },
      { kind: "extras", id: extrasListId.toUpperCase() },
    ],
  ],
] as const)("rejects %s in modifiers, naming %s", (_label, field, value) => {
  expect(() => parseProductEditorInput({ ...input, modifiers: value })).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field } }),
  );
});

it.each(["modifierIds", "optionGroupIds"] as const)(
  "refuses the legacy %s field rather than silently ignoring it",
  (legacy) => {
    // Silently dropping it would save a product with NO attachments and report success, which is the
    // one outcome a caller still on the old contract could not tell from having worked.
    expect(() => parseProductEditorInput({ ...input, [legacy]: [extrasListId] })).toThrow(
      expect.objectContaining({ code: "product.invalid", params: { field: legacy } }),
    );
    // Even an empty legacy array is refused: it still says the caller is on the old contract.
    expect(() => parseProductEditorInput({ ...input, [legacy]: [] })).toThrow(
      expect.objectContaining({ code: "product.invalid", params: { field: legacy } }),
    );
  },
);
