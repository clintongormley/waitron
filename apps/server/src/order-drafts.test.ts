import { describe, expect, it } from "vitest";
import { normaliseDraftLines } from "./order-drafts.js";
import type { DraftLine } from "./order-drafts.js";

const BEER = "aaaaaaaa-0000-4000-8000-000000000001";
const BURGER = "aaaaaaaa-0000-4000-8000-000000000002";
const FISH = "aaaaaaaa-0000-4000-8000-000000000003";
const DONENESS = "aaaaaaaa-1111-4000-8000-000000000001";
const ONIONS = "aaaaaaaa-1111-4000-8000-000000000002";
const TOPPINGS = "aaaaaaaa-2222-4000-8000-000000000001";
const PREMIUM_TOPPINGS = "aaaaaaaa-2222-4000-8000-000000000002";
const CHEESE = "aaaaaaaa-3333-4000-8000-000000000001";
const BACON = "aaaaaaaa-3333-4000-8000-000000000002";

const RARE = { listId: DONENESS, labelId: "rare" };
const WELL_DONE = { listId: DONENESS, labelId: "well-done" };
const NO_ONIONS = { listId: ONIONS, labelId: "none" };

let nextId = 0;

function line(overrides: Partial<DraftLine> & { menuItemId: string }): DraftLine {
  nextId += 1;
  return {
    id: `line-${nextId}`,
    variantId: null,
    menuVersionId: "version-7",
    options: [],
    extras: [],
    note: null,
    quantity: "1.000",
    courseId: null,
    noMerge: false,
    unavailable: false,
    ...overrides,
  };
}

/** What the rows say, without the ids a merge keeps from whichever row came first. */
const summary = (lines: DraftLine[]) =>
  lines.map(({ menuItemId, quantity }) => ({ menuItemId, quantity }));

describe("normaliseDraftLines (D10)", () => {
  it("gives one line Beer ×3 from three saves that each add a Beer", () => {
    const first = line({ menuItemId: BEER });
    let lines = normaliseDraftLines([first]);
    lines = normaliseDraftLines([...lines, line({ menuItemId: BEER })]);
    lines = normaliseDraftLines([...lines, line({ menuItemId: BEER })]);
    expect(lines).toEqual([{ ...first, quantity: "3.000" }]);
  });

  it("keeps the first row's id and position, and every other row where it was", () => {
    const burger = line({ menuItemId: BURGER });
    const beer = line({ menuItemId: BEER, quantity: "2.000" });
    const fish = line({ menuItemId: FISH });
    const secondBeer = line({ menuItemId: BEER });
    expect(normaliseDraftLines([burger, beer, fish, secondBeer])).toEqual([
      burger,
      { ...beer, quantity: "3.000" },
      fish,
    ]);
  });

  it("merges a Burger with options [no onions, rare] and one with [rare, no onions]", () => {
    const first = line({ menuItemId: BURGER, options: [NO_ONIONS, RARE] });
    const second = line({ menuItemId: BURGER, options: [RARE, NO_ONIONS] });
    expect(normaliseDraftLines([first, second])).toEqual([{ ...first, quantity: "2.000" }]);
  });

  it("does not merge a rare Burger with a well-done one", () => {
    const lines = [
      line({ menuItemId: BURGER, options: [RARE] }),
      line({ menuItemId: BURGER, options: [WELL_DONE] }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("does not merge a Burger with no options into one with an option", () => {
    const lines = [line({ menuItemId: BURGER }), line({ menuItemId: BURGER, options: [RARE] })];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("does not merge lines with different notes, nor a note with none", () => {
    const lines = [
      line({ menuItemId: BURGER, note: "no salt" }),
      line({ menuItemId: BURGER, note: "extra sauce" }),
      line({ menuItemId: BURGER }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("merges lines with the same note", () => {
    const first = line({ menuItemId: BURGER, note: "no salt" });
    expect(normaliseDraftLines([first, line({ menuItemId: BURGER, note: "no salt" })])).toEqual([
      { ...first, quantity: "2.000" },
    ]);
  });

  it('does not merge an extra from "Toppings" with the same extra from "Premium toppings"', () => {
    const lines = [
      line({
        menuItemId: BURGER,
        extras: [{ listId: TOPPINGS, picks: [{ productId: CHEESE, quantity: 1 }] }],
      }),
      line({
        menuItemId: BURGER,
        extras: [{ listId: PREMIUM_TOPPINGS, picks: [{ productId: CHEESE, quantity: 1 }] }],
      }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("does not merge lines whose extras differ only in how many of a pick", () => {
    const lines = [
      line({
        menuItemId: BURGER,
        extras: [{ listId: TOPPINGS, picks: [{ productId: CHEESE, quantity: 1 }] }],
      }),
      line({
        menuItemId: BURGER,
        extras: [{ listId: TOPPINGS, picks: [{ productId: CHEESE, quantity: 2 }] }],
      }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("merges lines with the same extras picked and listed in a different order", () => {
    const first = line({
      menuItemId: BURGER,
      extras: [
        { listId: TOPPINGS, picks: [{ productId: CHEESE, quantity: 1 }] },
        { listId: PREMIUM_TOPPINGS, picks: [{ productId: BACON, quantity: 2 }] },
      ],
    });
    const second = line({
      menuItemId: BURGER,
      extras: [
        { listId: PREMIUM_TOPPINGS, picks: [{ productId: BACON, quantity: 2 }] },
        { listId: TOPPINGS, picks: [{ productId: CHEESE, quantity: 1 }] },
      ],
    });
    expect(normaliseDraftLines([first, second])).toEqual([{ ...first, quantity: "2.000" }]);
  });

  it("treats a pick listed twice as that pick with twice the quantity", () => {
    const first = line({
      menuItemId: BURGER,
      extras: [
        {
          listId: TOPPINGS,
          picks: [
            { productId: CHEESE, quantity: 1 },
            { productId: CHEESE, quantity: 1 },
          ],
        },
      ],
    });
    const second = line({
      menuItemId: BURGER,
      extras: [{ listId: TOPPINGS, picks: [{ productId: CHEESE, quantity: 2 }] }],
    });
    expect(normaliseDraftLines([first, second])).toEqual([{ ...first, quantity: "2.000" }]);
  });

  it("leaves Split quantity's three no-merge Burger rows apart on the next save", () => {
    const split = [1, 2, 3].map(() => line({ menuItemId: BURGER, noMerge: true }));
    expect(normaliseDraftLines(split)).toEqual(split);
    const added = line({ menuItemId: BURGER });
    expect(normaliseDraftLines([...split, added])).toEqual([...split, added]);
    expect(normaliseDraftLines([added, ...split])).toEqual([added, ...split]);
  });

  it.each([
    ["menu item", { menuItemId: FISH }],
    ["variant", { variantId: "variant-large" }],
    ["menu version", { menuVersionId: "version-8" }],
    ["course", { courseId: "course-mains" }],
  ])("does not merge lines of a different %s", (_field, difference) => {
    const lines = [line({ menuItemId: BURGER }), line({ menuItemId: BURGER, ...difference })];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("merges lines of the same variant, version and course", () => {
    const same = { variantId: "variant-large", menuVersionId: "version-8", courseId: "mains" };
    const first = line({ menuItemId: BURGER, ...same });
    expect(normaliseDraftLines([first, line({ menuItemId: BURGER, ...same })])).toEqual([
      { ...first, quantity: "2.000" },
    ]);
  });

  it("never merges a weighed quantity: 0.5 and 0.3 of one fish stay two rows", () => {
    const lines = [
      line({ menuItemId: FISH, quantity: "0.500" }),
      line({ menuItemId: FISH, quantity: "0.300" }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("never merges a whole quantity with a fractional one", () => {
    const lines = [
      line({ menuItemId: FISH, quantity: "1.000" }),
      line({ menuItemId: FISH, quantity: "0.500" }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("adds whole quantities exactly, whatever places they are written with", () => {
    const lines = normaliseDraftLines([
      line({ menuItemId: BEER, quantity: "2" }),
      line({ menuItemId: BEER, quantity: "1.000" }),
      line({ menuItemId: BEER, quantity: "4.0" }),
    ]);
    expect(summary(lines)).toEqual([{ menuItemId: BEER, quantity: "7.000" }]);
  });
});
