import { describe, expect, it } from "vitest";
import { parseModifierInput, validateModifierSelections } from "./modifier-contract.js";

const modifierId = "11111111-1111-4111-8111-111111111111";
const choiceId = "22222222-2222-4222-8222-222222222222";
const name = { en: "Extras" };
const extra = {
  id: choiceId,
  name: { en: "Bacon" },
  available: true,
  priceDelta: "1.00",
  maxQuantity: 2,
  preselected: false,
};
const extras = {
  id: modifierId,
  type: "extras" as const,
  name,
  available: true,
  required: false,
  maxTotalQuantity: null,
  choices: [extra],
};

describe("modifier definition contract", () => {
  it("rejects the removed yes-no type", () => {
    expect(() =>
      parseModifierInput({ type: "yes-no", name: { en: "Gift wrap" }, defaultValue: true }),
    ).toThrow(expect.objectContaining({ code: "modifier.invalid", params: { field: "type" } }));
  });
  it("accepts direct dietary invalidations and rejects legacy origin authoring", () => {
    expect(
      parseModifierInput({
        type: "extras",
        name,
        choices: [{ ...extra, dietaryEffect: { invalidates: ["no_meat", "halal"] } }],
      }),
    ).toMatchObject({
      choices: [{ dietaryEffect: { invalidates: ["no_meat", "halal"] } }],
    });
    expect(() =>
      parseModifierInput({
        type: "extras",
        name,
        choices: [{ ...extra, addOrigins: ["meat"] }],
      }),
    ).toThrow(expect.objectContaining({ code: "modifier.invalid" }));
  });
  it("accepts every type with canonical defaults", () => {
    expect(parseModifierInput({ type: "text", name })).toEqual({
      type: "text",
      name,
      available: true,
    });
    expect(parseModifierInput({ type: "extras", name, choices: [{ id: choiceId, name }] })).toEqual(
      {
        type: "extras",
        name,
        available: true,
        required: false,
        maxTotalQuantity: null,
        choices: [
          {
            id: choiceId,
            name,
            available: true,
            dietaryEffect: { invalidates: [] },
            priceDelta: "0.00",
            maxQuantity: 1,
            preselected: false,
          },
        ],
      },
    );
    expect(
      parseModifierInput({ type: "options", name, choices: [{ id: choiceId, name }] }),
    ).toEqual({
      type: "options",
      name,
      available: true,
      choices: [{ id: choiceId, name, available: true, dietaryEffect: { invalidates: [] } }],
      defaultChoiceId: null,
    });
  });
  it.each([
    { type: "text", name, choices: [] },
    { type: "options", name, choices: [{ id: choiceId, name, priceDelta: "1.00" }] },
    { ...extras, maxTotalQuantity: 0 },
    { ...extras, choices: [{ ...extra, priceDelta: "-0.01" }] },
    { type: "options", name, choices: [{ id: choiceId, name }], defaultChoiceId: modifierId },
    { ...extras, choices: [extra, extra] },
  ])("rejects contradictory fields and invalid defaults %#", (input) => {
    const body = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "id"));
    expect(() => parseModifierInput(body)).toThrow();
  });
  it("clears unavailable defaults in the same canonical value", () => {
    expect(
      parseModifierInput({
        type: "extras",
        name,
        choices: [{ ...extra, available: false, preselected: true }],
      }),
    ).toMatchObject({ choices: [{ preselected: false }] });
    const usableChoice = "33333333-3333-4333-8333-333333333333";
    expect(
      parseModifierInput({
        type: "options",
        name,
        choices: [
          { id: choiceId, name, available: false },
          { id: usableChoice, name, available: true },
        ],
        defaultChoiceId: choiceId,
      }),
    ).toMatchObject({ defaultChoiceId: null });
  });
  it("refuses an available required definition with no usable choices", () => {
    expect(() => parseModifierInput({ type: "options", name, choices: [] })).toThrow();
    expect(() =>
      parseModifierInput({
        type: "extras",
        name,
        required: true,
        choices: [{ ...extra, available: false }],
      }),
    ).toThrow();
    // A modifier can no longer be turned off as a whole, so a sent `available: false` is ignored
    // and an empty options modifier is still refused.
    expect(() =>
      parseModifierInput({ type: "options", name, available: false, choices: [] }),
    ).toThrow();
  });
});

describe("explicit order selections", () => {
  it("validates every value, preserving literal text", () => {
    const definitions = [
      extras,
      { id: "text", type: "text" as const, name, available: true },
      {
        id: "option",
        type: "options" as const,
        name,
        available: true,
        choices: [{ id: choiceId, name, available: true }],
        defaultChoiceId: null,
      },
    ];
    const selections = [
      { modifierId, type: "extras", choices: [{ choiceId, quantity: 2 }] },
      { modifierId: "text", type: "text", text: " <b>literal</b> " },
      { modifierId: "option", type: "options", choiceId },
    ];
    expect(validateModifierSelections(definitions, selections)).toEqual(selections);
  });
  it("allows an unlimited total, but enforces a finite sum", () => {
    const selection = [{ modifierId, type: "extras", choices: [{ choiceId, quantity: 2 }] }];
    expect(validateModifierSelections([extras], selection)).toEqual(selection);
    expect(() =>
      validateModifierSelections([{ ...extras, maxTotalQuantity: 1 }], selection),
    ).toThrow();
  });
  it.each([
    [
      { choiceId, quantity: 2 },
      { choiceId, quantity: -1 },
    ],
    [
      { choiceId, quantity: 1 },
      { choiceId, quantity: 1 },
    ],
    [{ choiceId, quantity: 0 }],
    [{ choiceId, quantity: 1.5 }],
    [{ choiceId, quantity: 3 }],
    [{ choiceId: "unknown", quantity: 1 }],
  ])("rejects invalid entries before summing %#", (...choices) => {
    expect(() =>
      validateModifierSelections([extras], [{ modifierId, type: "extras", choices }]),
    ).toThrow();
  });
  it("rejects duplicate modifiers, wrong types and unavailable choices", () => {
    const selection = { modifierId, type: "extras", choices: [{ choiceId, quantity: 1 }] };
    expect(() => validateModifierSelections([extras], [selection, selection])).toThrow();
    expect(() =>
      validateModifierSelections([extras], [{ modifierId, type: "text", text: "test" }]),
    ).toThrow();
    expect(() =>
      validateModifierSelections(
        [{ ...extras, choices: [{ ...extra, available: false }] }],
        [selection],
      ),
    ).toThrow();
  });
  it("does not waive required groups with no offered choices or apply server defaults", () => {
    expect(() =>
      validateModifierSelections([{ ...extras, required: true, choices: [] }], []),
    ).toThrow();
    expect(() =>
      validateModifierSelections(
        [{ ...extras, required: true, choices: [{ ...extra, preselected: true }] }],
        [],
      ),
    ).toThrow();
  });
  it("omits blank text and bounds literal text at 500 characters", () => {
    const text = { id: modifierId, type: "text" as const, name, available: true };
    expect(validateModifierSelections([text], [{ modifierId, type: "text", text: "   " }])).toEqual(
      [],
    );
    expect(() =>
      validateModifierSelections([text], [{ modifierId, type: "text", text: "a".repeat(501) }]),
    ).toThrow();
  });
});

function expectInvalid(run: () => unknown, field: string) {
  let failure: unknown;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: "modifier.invalid", params: { field } });
}

const extraInput = { type: "extras", name, choices: [extra] };
const optionInput = { type: "options", name, choices: [{ id: choiceId, name }] };
describe("strict definition input boundaries", () => {
  it.each([
    [{ ...extraInput, required: null }, "required"],
    [{ ...extraInput, choices: [{ ...extra, available: null }] }, "choices.0.available"],
    [{ ...extraInput, choices: [{ ...extra, priceDelta: null }] }, "choices.0.priceDelta"],
    [{ ...extraInput, choices: [{ ...extra, maxQuantity: null }] }, "choices.0.maxQuantity"],
    [{ ...extraInput, choices: [{ ...extra, preselected: null }] }, "choices.0.preselected"],
  ])("rejects explicit null instead of silently applying a default: %#", (input, field) => {
    expectInvalid(() => parseModifierInput(input), field as string);
  });

  it.each(["false", 0, [], {}])("rejects non-Boolean values %#", (value) => {
    expectInvalid(() => parseModifierInput({ ...extraInput, required: value }), "required");
    expectInvalid(
      () =>
        parseModifierInput({ ...optionInput, choices: [{ id: choiceId, name, available: value }] }),
      "choices.0.available",
    );
  });

  it.each([null, [], "Bacon", 1, { en: null }, { en: 1 }, { en: { label: "Bacon" } }])(
    "rejects invalid translated-label shapes %#",
    (value) => {
      expectInvalid(() => parseModifierInput({ type: "text", name: value }), "name");
      expectInvalid(
        () => parseModifierInput({ ...extraInput, choices: [{ ...extra, name: value }] }),
        "choices.0.name",
      );
    },
  );

  it.each([null, [], "choice", 1])("rejects nonobject choices %#", (choice) => {
    expectInvalid(() => parseModifierInput({ ...extraInput, choices: [choice] }), "choices.0");
  });

  it.each([
    [{ type: "text", name, defaultValue: false }, "modifier.defaultValue"],
    [{ ...extraInput, defaultChoiceId: null }, "modifier.defaultChoiceId"],
    [{ ...optionInput, required: null }, "modifier.required"],
    [
      { ...optionInput, choices: [{ id: choiceId, name, maxQuantity: null }] },
      "choices.0.maxQuantity",
    ],
    [
      { ...optionInput, choices: [{ id: choiceId, name, preselected: false }] },
      "choices.0.preselected",
    ],
    [{ ...optionInput, choices: [{ id: choiceId, name, vatClass: null }] }, "choices.0.vatClass"],
    [{ ...extraInput, choices: [{ ...extra, defaultValue: false }] }, "choices.0.defaultValue"],
  ])("rejects keys from other types even when their value is null: %#", (input, field) => {
    expectInvalid(() => parseModifierInput(input), field as string);
  });

  it.each(["-0.01", "1.001", "1e2", "NaN", "Infinity", "10000000000.00", " 1.00", 1])(
    "rejects negative, excessive-scale or nonliteral prices %#",
    (priceDelta) => {
      expectInvalid(
        () => parseModifierInput({ ...extraInput, choices: [{ ...extra, priceDelta }] }),
        "choices.0.priceDelta",
      );
    },
  );

  it("normalizes decimal prices without losing the database's maximum money value", () => {
    for (const [priceDelta, expected] of [
      ["0001.2", "1.20"],
      ["0", "0.00"],
      ["9999999999.99", "9999999999.99"],
    ]) {
      expect(
        parseModifierInput({ ...extraInput, choices: [{ ...extra, priceDelta }] }),
      ).toMatchObject({ choices: [{ priceDelta: expected }] });
    }
  });

  it.each([0, -1, 1.25, NaN, Infinity, Number.MAX_SAFE_INTEGER, 2147483648, "2"])(
    "rejects quantities that cannot be positive database integers %#",
    (maxQuantity) => {
      expectInvalid(
        () => parseModifierInput({ ...extraInput, choices: [{ ...extra, maxQuantity }] }),
        "choices.0.maxQuantity",
      );
      expectInvalid(
        () => parseModifierInput({ ...extraInput, maxTotalQuantity: maxQuantity }),
        "maxTotalQuantity",
      );
    },
  );

  it.each(
    [["general"], { toString: () => "general" }, 0, "unknown"].map((vatClass) => ({ vatClass })),
  )("rejects non-enum VAT values without coercion %#", ({ vatClass }) => {
    expectInvalid(
      () => parseModifierInput({ ...extraInput, choices: [{ ...extra, vatClass }] }),
      "choices.0.vatClass",
    );
  });

  it("retains explicit false and nullable fields while clearing unavailable defaults before checking the cap", () => {
    expect(
      parseModifierInput({
        ...extraInput,
        required: false,
        maxTotalQuantity: 1,
        choices: [{ ...extra, available: false, preselected: true, vatClass: null }],
      }),
    ).toMatchObject({
      required: false,
      maxTotalQuantity: 1,
      choices: [{ available: false, preselected: false, vatClass: null }],
    });
    expect(parseModifierInput({ ...extraInput, maxTotalQuantity: null })).toMatchObject({
      maxTotalQuantity: null,
    });
    expect(parseModifierInput({ ...optionInput, defaultChoiceId: null })).toMatchObject({
      defaultChoiceId: null,
    });
  });
});

describe("adversarial explicit selections", () => {
  const option = {
    id: modifierId,
    name,
    available: true,
    type: "options" as const,
    defaultChoiceId: choiceId,
    choices: [{ id: choiceId, name, available: true }],
  };
  const text = { id: modifierId, name, available: true, type: "text" as const };

  it("does not manufacture a missing default option selection", () => {
    expectInvalid(() => validateModifierSelections([option], []), "required");
  });
  it("rejects cross-type selection fields, client prices and labels", () => {
    expectInvalid(
      () =>
        validateModifierSelections(
          [option],
          [{ modifierId, type: "options", choiceId, quantity: 2 }],
        ),
      "selection.quantity",
    );
    expectInvalid(
      () =>
        validateModifierSelections(
          [text],
          [{ modifierId, type: "text", text: "Note", value: false }],
        ),
      "selection.value",
    );
    expectInvalid(
      () =>
        validateModifierSelections(
          [extras],
          [
            {
              modifierId,
              type: "extras",
              choices: [{ choiceId, quantity: 1, priceDelta: "0.00" }],
            },
          ],
        ),
      "choice.priceDelta",
    );
    expectInvalid(
      () =>
        validateModifierSelections([extras], [{ modifierId, type: "extras", name, choices: [] }]),
      "selection.name",
    );
  });
  it.each([null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 2147483648, "1"])(
    "refuses invalid repeated-extra quantities %#",
    (quantity) => {
      expectInvalid(
        () =>
          validateModifierSelections(
            [extras],
            [{ modifierId, type: "extras", choices: [{ choiceId, quantity }] }],
          ),
        "quantity",
      );
    },
  );
  it("sums large distinct extras without a signed integer overflow", () => {
    const max = 2147483647;
    const secondId = "33333333-3333-4333-8333-333333333333";
    const definition = {
      ...extras,
      choices: [
        { ...extra, maxQuantity: max },
        { ...extra, id: secondId, maxQuantity: max },
      ],
    };
    const selections = [
      {
        modifierId,
        type: "extras",
        choices: [
          { choiceId, quantity: max },
          { choiceId: secondId, quantity: max },
        ],
      },
    ];
    expect(validateModifierSelections([definition], selections)).toEqual(selections);
    expectInvalid(
      () => validateModifierSelections([{ ...definition, maxTotalQuantity: max }], selections),
      "choices",
    );
  });
});

describe("preselected extras", () => {
  it("accepts a preselected extras choice and rejects defaultQuantity", () => {
    const parsed = parseModifierInput({
      type: "extras",
      name: { en: "Extras" },
      required: false,
      maxTotalQuantity: null,
      choices: [
        {
          id: crypto.randomUUID(),
          name: { en: "Cheese" },
          available: true,
          priceDelta: "1.00",
          maxQuantity: 2,
          preselected: true,
        },
      ],
    });
    if (parsed.type !== "extras") throw new Error("type");
    expect(parsed.choices[0]!.preselected).toBe(true);
    expect("defaultQuantity" in parsed.choices[0]!).toBe(false);
    expect(() =>
      parseModifierInput({
        type: "extras",
        name: { en: "Extras" },
        required: false,
        maxTotalQuantity: null,
        choices: [
          {
            id: crypto.randomUUID(),
            name: { en: "Cheese" },
            available: true,
            priceDelta: "1.00",
            maxQuantity: 2,
            defaultQuantity: 1,
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "modifier.invalid" }));
  });

  it("forces preselected false on an unavailable extras choice", () => {
    const parsed = parseModifierInput({
      type: "extras",
      name: { en: "Extras" },
      required: false,
      maxTotalQuantity: null,
      choices: [
        {
          id: crypto.randomUUID(),
          name: { en: "Cheese" },
          available: false,
          priceDelta: "1.00",
          maxQuantity: 2,
          preselected: true,
        },
      ],
    });
    if (parsed.type !== "extras") throw new Error("type");
    expect(parsed.choices[0]!.preselected).toBe(false);
  });

  it("rejects more preselected choices than the total cap", () => {
    const choice = (name: string) => ({
      id: crypto.randomUUID(),
      name: { en: name },
      available: true,
      priceDelta: "1.00",
      maxQuantity: 1,
      preselected: true,
    });
    expect(() =>
      parseModifierInput({
        type: "extras",
        name: { en: "Extras" },
        required: false,
        maxTotalQuantity: 1,
        choices: [choice("A"), choice("B")],
      }),
    ).toThrow(
      expect.objectContaining({ code: "modifier.invalid", params: { field: "maxTotalQuantity" } }),
    );
  });

  it("fixes availability to true for extras regardless of the value sent", () => {
    const input = parseModifierInput({
      type: "extras",
      name: { en: "Extras" },
      available: false,
      required: false,
      maxTotalQuantity: null,
      choices: [{ id: crypto.randomUUID(), name: { en: "Cheese" }, available: true }],
    });
    expect(input.available).toBe(true);
  });

  it("normalises an absent, null, or empty dietary effect on a choice to an empty invalidates list", () => {
    const id = crypto.randomUUID();
    const choiceOf = (dietaryEffect: unknown) =>
      (
        parseModifierInput({
          type: "options",
          name: { en: "Sauce" },
          defaultChoiceId: null,
          choices: [
            {
              id,
              name: { en: "Ketchup" },
              available: true,
              ...(dietaryEffect === "absent" ? {} : { dietaryEffect }),
            },
          ],
        }) as { choices: { dietaryEffect?: { invalidates: string[] } | null }[] }
      ).choices[0]!.dietaryEffect;
    expect(choiceOf("absent")).toEqual({ invalidates: [] });
    expect(choiceOf(null)).toEqual({ invalidates: [] });
    expect(choiceOf({ invalidates: [] })).toEqual({ invalidates: [] });
  });
});
