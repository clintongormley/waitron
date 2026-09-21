import { describe, expect, it } from "vitest";
import {
  parseOptionListInput,
  validateOptionSelections,
  type OptionList,
} from "./option-contract.js";

const cookedId = "11111111-1111-4111-8111-111111111111";
const mediumRareId = "22222222-2222-4222-8222-222222222222";
const wellDoneId = "33333333-3333-4333-8333-333333333333";
const sauceId = "44444444-4444-4444-8444-444444444444";
const aioliId = "55555555-5555-4555-8555-555555555555";
const unknownId = "66666666-6666-4666-8666-666666666666";

// The three names carry three DIFFERENT texts everywhere, so a function reading the wrong one fails
// rather than passing on a coincidence (CLAUDE.md §3).
const mediumRare = {
  id: mediumRareId,
  name: "Medium rare",
  customerName: { en: "Cooked medium rare", es: "Al punto" },
  kitchenName: "MR",
  available: true,
};
const wellDone = {
  id: wellDoneId,
  name: "Well done",
  customerName: { en: "Cooked all the way through", es: "Muy hecho" },
  kitchenName: "WD",
  available: true,
};
const cooked = {
  name: "Cooked",
  customerName: { en: "How would you like it cooked?", es: "¿Qué punto?" },
  kitchenName: "Cook",
  defaultLabelId: mediumRareId,
  active: true,
  labels: [mediumRare, wellDone],
};

/** A list as it comes back from storage: every label carries an id. */
function list(overrides: Partial<OptionList> = {}): OptionList {
  return {
    id: cookedId,
    name: "Cooked",
    customerName: { en: "How would you like it cooked?" },
    kitchenName: "Cook",
    defaultLabelId: mediumRareId,
    active: true,
    labels: [
      { ...mediumRare, customerName: { ...mediumRare.customerName } },
      { ...wellDone, customerName: { ...wellDone.customerName } },
    ],
    ...overrides,
  };
}

const sauces: OptionList = {
  id: sauceId,
  name: "Sauce",
  customerName: { en: "Which sauce?" },
  kitchenName: "Sce",
  defaultLabelId: null,
  active: true,
  labels: [
    {
      id: aioliId,
      name: "Aioli",
      customerName: { es: "Alioli" },
      kitchenName: "AIO",
      available: true,
    },
  ],
};

describe("option list authoring contract", () => {
  it("refuses a list whose staff name is blank", () => {
    expect(() => parseOptionListInput({ ...cooked, name: "   " })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "name" } }),
    );
  });

  it("refuses a label whose staff name is blank, naming the offending position", () => {
    expect(() =>
      parseOptionListInput({
        ...cooked,
        defaultLabelId: null,
        labels: [mediumRare, { ...wellDone, name: "" }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.1.name" } }),
    );
  });

  it("refuses an unknown key on the list", () => {
    expect(() => parseOptionListInput({ ...cooked, priceDelta: "1.00" })).toThrowError(
      expect.objectContaining({
        code: "options.invalid",
        params: { field: "optionList.priceDelta" },
      }),
    );
  });

  it("refuses an unknown key on a label", () => {
    expect(() =>
      parseOptionListInput({ ...cooked, labels: [{ ...mediumRare, priceDelta: "1.00" }] }),
    ).toThrowError(
      expect.objectContaining({
        code: "options.invalid",
        params: { field: "labels.0.priceDelta" },
      }),
    );
  });

  it("keeps label order and all three names, and defaults active and available to true", () => {
    const parsed = parseOptionListInput({
      name: "Cooked",
      customerName: { en: "How would you like it cooked?", es: "¿Qué punto?" },
      kitchenName: "Cook",
      defaultLabelId: mediumRareId,
      labels: [
        {
          id: mediumRareId,
          name: "Medium rare",
          customerName: { es: "Al punto" },
          kitchenName: "MR",
        },
        { id: wellDoneId, name: "Well done", customerName: { es: "Muy hecho" }, kitchenName: "WD" },
      ],
    });
    expect(parsed).toEqual({
      name: "Cooked",
      customerName: { en: "How would you like it cooked?", es: "¿Qué punto?" },
      kitchenName: "Cook",
      defaultLabelId: mediumRareId,
      active: true,
      labels: [
        {
          id: mediumRareId,
          name: "Medium rare",
          customerName: { es: "Al punto" },
          kitchenName: "MR",
          available: true,
        },
        {
          id: wellDoneId,
          name: "Well done",
          customerName: { es: "Muy hecho" },
          kitchenName: "WD",
          available: true,
        },
      ],
    });
  });

  it("normalises an absent customer name and a blank kitchen name to null", () => {
    const parsed = parseOptionListInput({
      name: "Cooked",
      kitchenName: "   ",
      labels: [{ name: "Medium rare", customerName: null, kitchenName: null }],
    });
    expect(parsed.customerName).toBeNull();
    expect(parsed.kitchenName).toBeNull();
    expect(parsed.defaultLabelId).toBeNull();
    expect(parsed.labels[0]).toEqual({
      name: "Medium rare",
      customerName: null,
      kitchenName: null,
      available: true,
    });
  });

  it("refuses a non-boolean active flag and a non-boolean label availability", () => {
    expect(() => parseOptionListInput({ ...cooked, active: "yes" })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "active" } }),
    );
    expect(() =>
      parseOptionListInput({ ...cooked, labels: [{ ...mediumRare, available: "yes" }] }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.0.available" } }),
    );
  });

  // A default is taken when a field is ABSENT and never when it is present and null — the rule
  // `CLAUDE.md` §3 states as "default optional request fields only when absent". `value ?? default`
  // is the shape that breaks it, and it breaks silently: an explicit null would be defaulted rather
  // than refused. The suite that used to hold this pair went with the old modifier contract in
  // Task 13 of `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`; this is its heir on
  // the options side. Proven by mutation, not by passing: with `flag`'s `value === undefined`
  // widened to `value == null`, both expectations below fail and the rest of the file stays green.
  it("refuses an explicit null where a default is only taken on absence", () => {
    expect(() => parseOptionListInput({ ...cooked, active: null })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "active" } }),
    );
    expect(() =>
      parseOptionListInput({ ...cooked, labels: [{ ...mediumRare, available: null }] }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.0.available" } }),
    );
  });

  it("refuses a customer name whose entries are not all text", () => {
    expect(() => parseOptionListInput({ ...cooked, customerName: { en: 7 } })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "customerName" } }),
    );
  });

  it("refuses labels that are not an array", () => {
    expect(() => parseOptionListInput({ ...cooked, labels: {} })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels" } }),
    );
  });

  it("refuses an active list whose every label is withdrawn", () => {
    expect(() =>
      parseOptionListInput({
        ...cooked,
        labels: [
          { ...mediumRare, available: false },
          { ...wellDone, available: false },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels" } }),
    );
  });

  it("refuses an active list that carries no labels at all", () => {
    expect(() =>
      parseOptionListInput({ ...cooked, defaultLabelId: null, labels: [] }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels" } }),
    );
  });

  it("accepts an inactive list with no available label, because it is never asked", () => {
    const parsed = parseOptionListInput({
      ...cooked,
      active: false,
      labels: [{ ...mediumRare, available: false }],
    });
    expect(parsed.active).toBe(false);
    expect(parsed.labels).toHaveLength(1);
    expect(parsed.labels[0]!.available).toBe(false);
  });

  it("refuses a defaultLabelId that names no label of the list", () => {
    expect(() => parseOptionListInput({ ...cooked, defaultLabelId: unknownId })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "defaultLabelId" } }),
    );
  });

  it("refuses a defaultLabelId that is not a uuid", () => {
    expect(() => parseOptionListInput({ ...cooked, defaultLabelId: "medium-rare" })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "defaultLabelId" } }),
    );
  });

  it("normalises a defaultLabelId naming an unavailable label to null", () => {
    const parsed = parseOptionListInput({
      ...cooked,
      labels: [{ ...mediumRare, available: false }, wellDone],
    });
    expect(parsed.defaultLabelId).toBeNull();
    expect(parsed.labels[0]!.available).toBe(false);
  });

  it("refuses a duplicate label id", () => {
    expect(() =>
      parseOptionListInput({
        ...cooked,
        labels: [mediumRare, { ...wellDone, id: mediumRareId }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.1.id" } }),
    );
  });

  // The ids above are all digits, so upper-casing one changes nothing. This one carries hex letters.
  const lettersId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("lower-cases a label id, so a default naming it in another case still matches", () => {
    const parsed = parseOptionListInput({
      ...cooked,
      defaultLabelId: lettersId.toUpperCase(),
      labels: [{ ...mediumRare, id: lettersId }, wellDone],
    });
    expect(parsed.labels[0]!.id).toBe(lettersId);
    expect(parsed.defaultLabelId).toBe(lettersId);
  });

  it("sees an upper-case repeat of a label id as the duplicate it is", () => {
    expect(() =>
      parseOptionListInput({
        ...cooked,
        defaultLabelId: null,
        labels: [
          { ...mediumRare, id: lettersId },
          { ...wellDone, id: lettersId.toUpperCase() },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.1.id" } }),
    );
  });

  it("folds an all-blank customer name to null, on the list and on a label", () => {
    const parsed = parseOptionListInput({
      ...cooked,
      customerName: { en: "   " },
      labels: [{ ...mediumRare, customerName: { en: "", es: " " } }, wellDone],
    });
    expect(parsed.customerName).toBeNull();
    expect(parsed.labels[0]!.customerName).toBeNull();
  });

  it("refuses a customer name whose key is not a language, naming the field", () => {
    expect(() => parseOptionListInput({ ...cooked, customerName: { zz: "Punto" } })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "customerName" } }),
    );
    expect(() =>
      parseOptionListInput({
        ...cooked,
        labels: [{ ...mediumRare, customerName: { zz: "Al punto" } }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "options.invalid",
        params: { field: "labels.0.customerName" },
      }),
    );
  });

  it("refuses a label id that is not a uuid", () => {
    expect(() =>
      parseOptionListInput({
        ...cooked,
        defaultLabelId: null,
        labels: [{ ...mediumRare, id: "mr" }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labels.0.id" } }),
    );
  });
});

describe("option selections at order time", () => {
  it("accepts exactly one answer per active list and returns them in list order", () => {
    const lists = [list(), sauces];
    expect(
      validateOptionSelections(lists, [
        { listId: sauceId, labelId: aioliId },
        { listId: cookedId, labelId: wellDoneId },
      ]),
    ).toEqual([
      { listId: cookedId, labelId: wellDoneId },
      { listId: sauceId, labelId: aioliId },
    ]);
  });

  // A `uuid` column hands its value back lower-cased, so the stored ids are lower case while a body
  // may send the same uuid in either case — `isUuid` accepts both. The ids here carry LETTERS
  // deliberately: the digit-only fixtures above are unchanged by `toUpperCase`, so a probe built on
  // them would pass whether this held or not (CLAUDE.md §1).
  it("accepts an answer whose ids are upper case, and answers with the stored lower-case ids", () => {
    const letteredListId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const letteredLabelId = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
    const lettered = list({
      id: letteredListId,
      defaultLabelId: letteredLabelId,
      labels: [{ ...mediumRare, id: letteredLabelId }],
    });
    expect(
      validateOptionSelections(
        [lettered],
        [{ listId: letteredListId.toUpperCase(), labelId: letteredLabelId.toUpperCase() }],
      ),
    ).toEqual([{ listId: letteredListId, labelId: letteredLabelId }]);
  });

  it("asks nothing of a list that is not active", () => {
    expect(validateOptionSelections([list({ active: false })], [])).toEqual([]);
  });

  it("refuses an unanswered list, carrying that list's id", () => {
    expect(() =>
      validateOptionSelections([list(), sauces], [{ listId: cookedId, labelId: mediumRareId }]),
    ).toThrowError(
      expect.objectContaining({
        code: "options.label_required",
        params: { optionListId: sauceId },
      }),
    );
  });

  it("refuses an answer naming a label the list does not carry", () => {
    expect(() =>
      validateOptionSelections([list()], [{ listId: cookedId, labelId: aioliId }]),
    ).toThrowError(
      expect.objectContaining({
        code: "options.label_required",
        params: { optionListId: cookedId },
      }),
    );
  });

  it("refuses an answer naming an unavailable label", () => {
    const withdrawn = list({
      labels: [{ ...mediumRare, available: false }, wellDone],
    });
    expect(() =>
      validateOptionSelections([withdrawn], [{ listId: cookedId, labelId: mediumRareId }]),
    ).toThrowError(
      expect.objectContaining({
        code: "options.label_required",
        params: { optionListId: cookedId },
      }),
    );
  });

  it("refuses two answers for the same list", () => {
    expect(() =>
      validateOptionSelections(
        [list()],
        [
          { listId: cookedId, labelId: mediumRareId },
          { listId: cookedId, labelId: wellDoneId },
        ],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "listId" } }),
    );
  });

  it("refuses an answer for a list that was not offered", () => {
    expect(() =>
      validateOptionSelections([list()], [{ listId: sauceId, labelId: aioliId }]),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "listId" } }),
    );
  });

  it("refuses an answer for a list that is not active", () => {
    expect(() =>
      validateOptionSelections(
        [list({ active: false })],
        [{ listId: cookedId, labelId: mediumRareId }],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "listId" } }),
    );
  });

  it("refuses selections that are not an array", () => {
    expect(() => validateOptionSelections([list()], { listId: cookedId })).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "optionSelections" } }),
    );
  });

  it("refuses an entry carrying an unknown key", () => {
    expect(() =>
      validateOptionSelections(
        [list()],
        [{ listId: cookedId, labelId: mediumRareId, quantity: 2 }],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "options.invalid",
        params: { field: "optionSelections.quantity" },
      }),
    );
  });

  it("refuses an entry whose ids are not strings", () => {
    expect(() =>
      validateOptionSelections([list()], [{ listId: cookedId, labelId: 7 }]),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labelId" } }),
    );
    expect(() =>
      validateOptionSelections([list()], [{ listId: 7, labelId: mediumRareId }]),
    ).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "listId" } }),
    );
  });

  it("refuses an entry that is missing labelId altogether", () => {
    expect(() => validateOptionSelections([list()], [{ listId: cookedId }])).toThrowError(
      expect.objectContaining({ code: "options.invalid", params: { field: "labelId" } }),
    );
  });
});
