import { describe, expect, it } from "vitest";
import { readExtraSelections, validateExtraSelections } from "./extra-contract.js";
import type { ExtraList } from "./extra-contract.js";
import { readOptionSelections, validateOptionSelections } from "./option-contract.js";
import type { OptionList } from "./option-contract.js";

const LIST = "11111111-1111-4111-8111-111111111111";
const OTHER_LIST = "22222222-2222-4222-8222-222222222222";
const LABEL = "33333333-3333-4333-8333-333333333333";
const OTHER_LABEL = "44444444-4444-4444-8444-444444444444";
const PRODUCT = "55555555-5555-4555-8555-555555555555";
const OTHER_PRODUCT = "66666666-6666-4666-8666-666666666666";

/** The lists the answers below name, so a validator refuses them only for their shape. */
const optionLists: OptionList[] = [LIST, OTHER_LIST].map((id) => ({
  id,
  name: "Doneness",
  customerName: null,
  kitchenName: null,
  defaultLabelId: null,
  active: true,
  labels: [LABEL, OTHER_LABEL].map((labelId) => ({
    id: labelId,
    name: "Rare",
    customerName: null,
    kitchenName: null,
    available: true,
  })),
}));
const extraLists: ExtraList[] = [LIST, OTHER_LIST].map((id) => ({
  id,
  name: "Sauces",
  customerName: null,
  kitchenName: null,
  minPicks: 0,
  maxPicks: null,
  active: true,
  items: [PRODUCT, OTHER_PRODUCT].map((productId) => ({
    id: productId,
    productId,
    maxQuantity: 9,
    preselected: false,
    price: null,
  })),
}));

const refusal = (code: string, field: string) =>
  expect.objectContaining({ code, params: { field } });

describe("readOptionSelections", () => {
  it("reads each answer in the order sent, with its ids in lower case", () => {
    expect(
      readOptionSelections([
        { listId: OTHER_LIST.toUpperCase(), labelId: OTHER_LABEL.toUpperCase() },
        { listId: LIST, labelId: LABEL },
      ]),
    ).toEqual([
      { listId: OTHER_LIST, labelId: OTHER_LABEL },
      { listId: LIST, labelId: LABEL },
    ]);
  });

  it.each([
    ["not a list", {}, "optionSelections"],
    ["an answer that is not an object", ["rare"], "optionSelections"],
    [
      "an answer with a field it does not have",
      [{ listId: LIST, labelId: LABEL, x: 1 }],
      "optionSelections.x",
    ],
    ["a list that is not text", [{ listId: 1, labelId: LABEL }], "listId"],
    ["a label that is not text", [{ listId: LIST }], "labelId"],
    [
      "the same answer twice",
      [
        { listId: LIST, labelId: LABEL },
        { listId: LIST, labelId: LABEL },
      ],
      "listId",
    ],
    [
      "two answers to one list, spelled in different cases",
      [
        { listId: LIST, labelId: LABEL },
        { listId: LIST.toUpperCase(), labelId: OTHER_LABEL },
      ],
      "listId",
    ],
  ])("refuses %s as the validator does", (_name, answers, field) => {
    expect(() => readOptionSelections(answers)).toThrow(refusal("options.invalid", field));
    expect(() => validateOptionSelections(optionLists, answers)).toThrow(
      refusal("options.invalid", field),
    );
  });

  it.each([
    ["a list that is no UUID", [{ listId: "doneness", labelId: LABEL }], "listId"],
    ["a label that is no UUID", [{ listId: LIST, labelId: "rare" }], "labelId"],
  ])("refuses %s, which it cannot check against a list", (_name, answers, field) => {
    expect(() => readOptionSelections(answers)).toThrow(refusal("options.invalid", field));
  });
});

describe("readExtraSelections", () => {
  it("reads each answer and pick in the order sent, with its ids in lower case", () => {
    expect(
      readExtraSelections([
        {
          listId: OTHER_LIST.toUpperCase(),
          picks: [
            { productId: OTHER_PRODUCT.toUpperCase(), quantity: 2 },
            { productId: PRODUCT, quantity: 1 },
          ],
        },
        { listId: LIST, picks: [] },
      ]),
    ).toEqual([
      {
        listId: OTHER_LIST,
        picks: [
          { productId: OTHER_PRODUCT, quantity: 2 },
          { productId: PRODUCT, quantity: 1 },
        ],
      },
      { listId: LIST, picks: [] },
    ]);
  });

  const pick = (quantity: unknown = 1, productId: unknown = PRODUCT) => ({ productId, quantity });
  it.each([
    ["not a list", "all", "extraSelections"],
    ["an answer that is not an object", [LIST], "extraSelections"],
    [
      "an answer with a field it does not have",
      [{ listId: LIST, picks: [], x: 1 }],
      "extraSelections.x",
    ],
    ["a list that is not text", [{ listId: 1, picks: [] }], "listId"],
    [
      "one list answered twice, spelled in different cases",
      [
        { listId: LIST, picks: [] },
        { listId: LIST.toUpperCase(), picks: [] },
      ],
      "listId",
    ],
    ["picks that are not a list", [{ listId: LIST, picks: "all" }], "picks"],
    ["a pick that is not an object", [{ listId: LIST, picks: [PRODUCT] }], "picks"],
    [
      "a pick with a field it does not have",
      [{ listId: LIST, picks: [{ ...pick(), price: "1.00" }] }],
      "picks.price",
    ],
    ["a pick whose product is not text", [{ listId: LIST, picks: [pick(1, 5)] }], "productId"],
    [
      "one product picked twice, spelled in different cases",
      [{ listId: LIST, picks: [pick(), pick(1, PRODUCT.toUpperCase())] }],
      "productId",
    ],
    ["a pick of none", [{ listId: LIST, picks: [pick(0)] }], "quantity"],
    ["a pick of one and a half", [{ listId: LIST, picks: [pick(1.5)] }], "quantity"],
    ["a pick counted as text", [{ listId: LIST, picks: [pick("1")] }], "quantity"],
    ["a pick above the largest count", [{ listId: LIST, picks: [pick(2147483648)] }], "quantity"],
  ])("refuses %s as the validator does", (_name, answers, field) => {
    expect(() => readExtraSelections(answers)).toThrow(refusal("extras.invalid", field));
    expect(() => validateExtraSelections(extraLists, answers)).toThrow(
      refusal("extras.invalid", field),
    );
  });

  it.each([
    ["a list that is no UUID", [{ listId: "sauces", picks: [] }], "listId"],
    ["a product that is no UUID", [{ listId: LIST, picks: [pick(1, "aioli")] }], "productId"],
  ])("refuses %s, which it cannot check against a list", (_name, answers, field) => {
    expect(() => readExtraSelections(answers)).toThrow(refusal("extras.invalid", field));
  });
});
