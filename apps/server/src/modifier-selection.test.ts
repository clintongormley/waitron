import { expect, it } from "vitest";
import type { ModifierSnapshot } from "@waitron/shared";
import { sameModifierSelections, selectionsFromSnapshots } from "./modifier-selection.js";

const snapshots: ModifierSnapshot[] = [
  {
    modifierId: "extras",
    type: "extras",
    name: { en: "Extras" },
    choices: [
      { choiceId: "a", name: { en: "A" }, quantity: 1 },
      { choiceId: "b", name: { en: "B" }, quantity: 2 },
    ],
  },
  {
    modifierId: "milk",
    type: "options",
    name: { en: "Milk" },
    choiceId: "oat",
    choiceName: { en: "Oat" },
  },
];

it("compares recorded answers independently of object, modifier and choice ordering", () => {
  expect(
    sameModifierSelections(
      [
        { choiceId: "oat", type: "options", modifierId: "milk" },
        {
          choices: [
            { quantity: 2, choiceId: "b" },
            { quantity: 1, choiceId: "a" },
          ],
          type: "extras",
          modifierId: "extras",
        },
      ],
      snapshots,
    ),
  ).toBe(true);
});

it.each(
  [
    null,
    {},
    [],
    [null, null],
    [{}, {}],
    [selectionsFromSnapshots(snapshots)[0], selectionsFromSnapshots(snapshots)[0]],
    [{ modifierId: "extras", type: "extras" }, selectionsFromSnapshots(snapshots)[1]],
    [
      { modifierId: "extras", type: "extras", choices: null },
      selectionsFromSnapshots(snapshots)[1],
    ],
    [
      {
        modifierId: "extras",
        type: "extras",
        choices: [
          { choiceId: "a", quantity: 1 },
          { choiceId: "a", quantity: 1 },
        ],
      },
      selectionsFromSnapshots(snapshots)[1],
    ],
    [
      {
        modifierId: "extras",
        type: "extras",
        choices: [
          { choiceId: "a", quantity: 2 },
          { choiceId: "b", quantity: 2 },
        ],
      },
      selectionsFromSnapshots(snapshots)[1],
    ],
    [
      selectionsFromSnapshots(snapshots)[0],
      { modifierId: "milk", type: "options", choiceId: "soy" },
    ],
    [
      selectionsFromSnapshots(snapshots)[0],
      { modifierId: "milk", type: "options", choiceId: "oat", unexpected: true },
    ],
  ].map((value) => ({ value })),
)("requires new validation for malformed or changed answers (%#)", ({ value }) => {
  expect(sameModifierSelections(value, snapshots)).toBe(false);
});
