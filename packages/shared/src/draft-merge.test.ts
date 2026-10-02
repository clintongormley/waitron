import { describe, expect, it } from "vitest";
import { draftLineMergeKey, normaliseDraftLines } from "./draft-merge.js";
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

/** Whether a draft holding `kept` adds `added` to that line: both keys equal and not null. */
function merges(kept: MergeableDraftLine, added: MergeableDraftLine): boolean {
  const key = draftLineMergeKey(kept);
  return key !== null && key === draftLineMergeKey(added);
}

describe("merging by draftLineMergeKey (D10)", () => {
  it("merges two lines of the same dish", () => {
    expect(merges(line({ menuItemId: BEER }), line({ menuItemId: BEER }))).toBe(true);
  });

  it.each([
    ["menu item", { menuItemId: FISH }],
    ["variant", { variantId: "variant-large" }],
    ["menu version", { menuVersionId: "version-8" }],
    ["course", { courseId: "course-mains" }],
    ["make-at station", { makeAt: "upstairs-bar" }],
    ["note", { note: "no salt" }],
    ["options answer", { options: [RARE] }],
    ["extras pick", { extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }],
  ])("does not merge lines that differ in their %s", (_part, difference) => {
    expect(merges(line({ menuItemId: BURGER }), line({ menuItemId: BURGER, ...difference }))).toBe(
      false,
    );
  });

  it("merges options answered in either order", () => {
    expect(
      merges(
        line({ menuItemId: BURGER, options: [NO_ONIONS, RARE] }),
        line({ menuItemId: BURGER, options: [RARE, NO_ONIONS] }),
      ),
    ).toBe(true);
  });

  it("does not merge a rare Burger with a well-done one", () => {
    expect(
      merges(
        line({ menuItemId: BURGER, options: [RARE] }),
        line({ menuItemId: BURGER, options: [WELL_DONE] }),
      ),
    ).toBe(false);
  });

  it("reads the options as a set: an answer given twice is that answer once", () => {
    expect(
      merges(
        line({ menuItemId: BURGER, options: [RARE, RARE] }),
        line({ menuItemId: BURGER, options: [RARE] }),
      ),
    ).toBe(true);
  });

  it('does not merge an extra from "Toppings" with the same extra from "Premium toppings"', () => {
    expect(
      merges(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
        line({ menuItemId: BURGER, extras: [{ listId: PREMIUM_TOPPINGS, picks: [cheese(1)] }] }),
      ),
    ).toBe(false);
  });

  it("does not merge two different extras from one list", () => {
    expect(
      merges(
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
      merges(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(2)] }] }),
      ),
    ).toBe(false);
  });

  it("merges the same extras listed in a different order", () => {
    const bacon = { listId: PREMIUM_TOPPINGS, picks: [{ productId: BACON, quantity: 2 }] };
    const toppings = { listId: TOPPINGS, picks: [cheese(1)] };
    expect(
      merges(
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
      merges(
        twice,
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(2)] }] }),
      ),
    ).toBe(true);
    expect(
      merges(
        twice,
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1)] }] }),
      ),
    ).toBe(false);
  });

  it("never merges a no-merge line, even with its identical twin", () => {
    const split = line({ menuItemId: BURGER, noMerge: true });
    expect(merges(split, { ...split })).toBe(false);
    expect(merges(split, line({ menuItemId: BURGER }))).toBe(false);
    expect(merges(line({ menuItemId: BURGER }), split)).toBe(false);
  });

  it("never merges a fractional quantity, even with its identical twin", () => {
    const fish = line({ menuItemId: FISH, quantity: "0.5" });
    expect(merges(fish, { ...fish })).toBe(false);
    expect(merges(fish, line({ menuItemId: FISH }))).toBe(false);
    expect(merges(line({ menuItemId: FISH }), fish)).toBe(false);
  });

  it("merges a whole-number weighed quantity, whatever places it is written with", () => {
    expect(
      merges(
        line({ menuItemId: FISH, quantity: "2.000" }),
        line({ menuItemId: FISH, quantity: "1" }),
      ),
    ).toBe(true);
  });
});

describe("draftLineMergeKey (D10)", () => {
  it("gives two lines ordering the same thing one key", () => {
    const key = draftLineMergeKey(
      line({ menuItemId: BURGER, quantity: "2.000", options: [NO_ONIONS, RARE] }),
    );
    expect(key).toEqual(expect.any(String));
    expect(draftLineMergeKey(line({ menuItemId: BURGER, options: [RARE, NO_ONIONS] }))).toBe(key);
  });

  it.each([
    ["menu item", { menuItemId: FISH }],
    ["variant", { variantId: "variant-large" }],
    ["menu version", { menuVersionId: "version-8" }],
    ["course", { courseId: "course-mains" }],
    ["note", { note: "no salt" }],
    ["options answer", { options: [WELL_DONE] }],
    ["extras pick", { extras: [{ listId: TOPPINGS, picks: [cheese(2)] }] }],
  ])("gives lines that differ in their %s different keys", (_part, difference) => {
    const burger = { menuItemId: BURGER, options: [RARE], extras: [] };
    const key = draftLineMergeKey(line(burger));
    expect(key).toEqual(expect.any(String));
    expect(draftLineMergeKey(line({ ...burger, ...difference }))).not.toBe(key);
  });

  it("gives a pick listed twice the key of that pick with its counts added", () => {
    expect(
      draftLineMergeKey(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(1), cheese(1)] }] }),
      ),
    ).toBe(
      draftLineMergeKey(
        line({ menuItemId: BURGER, extras: [{ listId: TOPPINGS, picks: [cheese(2)] }] }),
      ),
    );
  });

  it("gives a no-merge line and a fractional quantity no key", () => {
    expect(draftLineMergeKey(line({ menuItemId: BURGER, noMerge: true }))).toBeNull();
    expect(draftLineMergeKey(line({ menuItemId: FISH, quantity: "0.5" }))).toBeNull();
    expect(draftLineMergeKey(line({ menuItemId: FISH, quantity: "1.001" }))).toBeNull();
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
