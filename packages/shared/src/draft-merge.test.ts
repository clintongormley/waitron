import { describe, expect, it } from "vitest";
import { draftLinesMerge, normaliseDraftLines } from "./draft-merge.js";
import type { MergeableDraftLine } from "./draft-merge.js";

const BEER = "beer";
const BURGER = "burger";
const FISH = "fish";
const DONENESS = "doneness";
const ONIONS = "onions";
const TOPPINGS = "toppings";
const PREMIUM_TOPPINGS = "premium-toppings";
const CHEESE = "cheese";
const BACON = "bacon";

const RARE = { listId: DONENESS, labelId: "rare" };
const WELL_DONE = { listId: DONENESS, labelId: "well-done" };
const NO_ONIONS = { listId: ONIONS, labelId: "none" };

type Line = MergeableDraftLine & { id: string };

let nextId = 0;

function line(overrides: Partial<Line> & { menuItemId: string }): Line {
  nextId += 1;
  return {
    id: `line-${nextId}`,
    variantId: null,
    menuVersionId: "version-7",
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
    ...overrides,
  };
}

const cheese = (quantity: number) => ({ productId: CHEESE, quantity });

describe("draftLinesMerge (D10)", () => {
  it("merges two lines of the same dish", () => {
    expect(draftLinesMerge(line({ menuItemId: BEER }), line({ menuItemId: BEER }))).toBe(true);
  });

  it.each([
    ["menu item", { menuItemId: FISH }],
    ["variant", { variantId: "variant-large" }],
    ["menu version", { menuVersionId: "version-8" }],
    ["course", { courseId: "course-mains" }],
    ["note", { note: "no salt" }],
    ["options answer", { options: [RARE] }],
    ["extras pick", { extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }],
  ])("does not merge lines that differ in their %s", (_part, difference) => {
    expect(
      draftLinesMerge(line({ menuItemId: BURGER }), line({ menuItemId: BURGER, ...difference })),
    ).toBe(false);
  });

  it("merges options answered in either order", () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, options: [NO_ONIONS, RARE] }),
        line({ menuItemId: BURGER, options: [RARE, NO_ONIONS] }),
      ),
    ).toBe(true);
  });

  it("does not merge a rare Burger with a well-done one", () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, options: [RARE] }),
        line({ menuItemId: BURGER, options: [WELL_DONE] }),
      ),
    ).toBe(false);
  });

  it("reads the options as a set: an answer given twice is that answer once", () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, options: [RARE, RARE] }),
        line({ menuItemId: BURGER, options: [RARE] }),
      ),
    ).toBe(true);
  });

  it('does not merge an extra from "Toppings" with the same extra from "Premium toppings"', () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
        line({ menuItemId: BURGER, extras: [{ listId: PREMIUM_TOPPINGS, picks: [cheese(1)] }] }),
      ),
    ).toBe(false);
  });

  it("does not merge two different extras from one list", () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
        line({
          menuItemId: BURGER,
          extras: [{ listId: TOPPINGS, picks: [{ productId: BACON, quantity: 1 }] }],
        }),
      ),
    ).toBe(false);
  });

  it("does not merge lines whose extras differ only in how many of a pick", () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(2)] }] }),
      ),
    ).toBe(false);
  });

  it("merges the same extras listed in a different order", () => {
    const bacon = { listId: PREMIUM_TOPPINGS, picks: [{ productId: BACON, quantity: 2 }] };
    const toppings = { listId: TOPPINGS, picks: [cheese(1)] };
    expect(
      draftLinesMerge(
        line({ menuItemId: BURGER, extras: [toppings, bacon] }),
        line({ menuItemId: BURGER, extras: [bacon, toppings] }),
      ),
    ).toBe(true);
  });

  it("reads a pick listed twice as that pick with its counts added", () => {
    const twice = line({
      menuItemId: BURGER,
      extras: [{ listId: TOPPINGS, picks: [cheese(1), cheese(1)] }],
    });
    expect(
      draftLinesMerge(
        twice,
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(2)] }] }),
      ),
    ).toBe(true);
    expect(
      draftLinesMerge(
        twice,
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
      ),
    ).toBe(false);
  });

  it("never merges a no-merge line, even with its identical twin", () => {
    const split = line({ menuItemId: BURGER, noMerge: true });
    expect(draftLinesMerge(split, { ...split })).toBe(false);
    expect(draftLinesMerge(split, line({ menuItemId: BURGER }))).toBe(false);
    expect(draftLinesMerge(line({ menuItemId: BURGER }), split)).toBe(false);
  });

  it("never merges a fractional quantity, even with its identical twin", () => {
    const fish = line({ menuItemId: FISH, quantity: "0.5" });
    expect(draftLinesMerge(fish, { ...fish })).toBe(false);
    expect(draftLinesMerge(fish, line({ menuItemId: FISH }))).toBe(false);
    expect(draftLinesMerge(line({ menuItemId: FISH }), fish)).toBe(false);
  });

  it("merges a whole-number weighed quantity, whatever places it is written with", () => {
    expect(
      draftLinesMerge(
        line({ menuItemId: FISH, quantity: "2.000" }),
        line({ menuItemId: FISH, quantity: "1" }),
      ),
    ).toBe(true);
  });
});

describe("normaliseDraftLines (D10)", () => {
  it("gives one line Beer ×3 from three Beer rows", () => {
    const first = line({ menuItemId: BEER });
    const merged = normaliseDraftLines([
      first,
      line({ menuItemId: BEER }),
      line({ menuItemId: BEER }),
    ]);
    expect(merged).toEqual([{ ...first, quantity: "3.000" }]);
  });

  it("keeps the first row's id and position, and every other row where it was", () => {
    const burger = line({ menuItemId: BURGER });
    const beer = line({ menuItemId: BEER, quantity: "2" });
    const fish = line({ menuItemId: FISH });
    const secondBeer = line({ menuItemId: BEER });
    expect(normaliseDraftLines([burger, beer, fish, secondBeer])).toEqual([
      burger,
      { ...beer, quantity: "3.000" },
      fish,
    ]);
  });

  it("leaves no-merge rows apart, before and after a row they would otherwise merge with", () => {
    const split = [1, 2, 3].map(() => line({ menuItemId: BURGER, noMerge: true }));
    const added = line({ menuItemId: BURGER });
    expect(normaliseDraftLines([...split, added])).toEqual([...split, added]);
    expect(normaliseDraftLines([added, ...split])).toEqual([added, ...split]);
  });

  it("leaves fractional rows apart: 0.5 and 0.3 of one fish stay two rows", () => {
    const lines = [
      line({ menuItemId: FISH, quantity: "0.500" }),
      line({ menuItemId: FISH, quantity: "0.300" }),
    ];
    expect(normaliseDraftLines(lines)).toEqual(lines);
  });

  it("adds whole quantities exactly, at the quantity scale", () => {
    const merged = normaliseDraftLines([
      line({ menuItemId: BEER, quantity: "2" }),
      line({ menuItemId: BEER, quantity: "1.000" }),
      line({ menuItemId: BEER, quantity: "4.0" }),
    ]);
    expect(merged.map(({ quantity }) => quantity)).toEqual(["7.000"]);
  });

  it("does not change the lines it was given", () => {
    const first = line({ menuItemId: BEER });
    normaliseDraftLines([first, line({ menuItemId: BEER })]);
    expect(first.quantity).toBe("1");
  });
});
