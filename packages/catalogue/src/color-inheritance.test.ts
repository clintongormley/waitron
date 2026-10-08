import { describe, expect, it } from "vitest";
import {
  categoryColor,
  effectiveColor,
  isStoredColor,
  type ColorNode,
} from "./color-inheritance.js";

const tree = (entries: [string, ColorNode][]) => new Map(entries);
const drinks = tree([
  ["drinks", { parentId: null, color: "#256bb1" }],
  ["soft", { parentId: "drinks", color: null }],
  ["cold", { parentId: "soft", color: null }],
  ["juice", { parentId: "soft", color: "#25b125" }],
]);

describe("effectiveColor", () => {
  it("takes the product's own colour over its category's", () =>
    expect(effectiveColor("#b12525", "juice", drinks, null)).toBe("#b12525"));
  it("takes the main category's colour when the product has none", () =>
    expect(effectiveColor(null, "juice", drinks, null)).toBe("#25b125"));
  it("takes the nearest coloured category above an uncoloured one, two levels up", () =>
    expect(effectiveColor(null, "cold", drinks, null)).toBe("#256bb1"));
  it("is null for an uncategorised product and when nothing above is coloured", () => {
    expect(effectiveColor(null, null, drinks, null)).toBeNull();
    expect(categoryColor("a", tree([["a", { parentId: null, color: null }]]), null)).toBeNull();
  });
  it("ends at null for a category the tree lacks and for a loop in the data", () => {
    expect(categoryColor("gone", drinks, null)).toBeNull();
    const loop = tree([
      ["a", { parentId: "b", color: null }],
      ["b", { parentId: "a", color: null }],
    ]);
    expect(categoryColor("a", loop, null)).toBeNull();
  });
});

describe("the venue default at the end of the walk", () => {
  const fallback = "#777777";
  it("is an uncategorised product's colour", () =>
    expect(effectiveColor(null, null, drinks, fallback)).toBe(fallback));
  it("is the colour of a category with nothing coloured above it", () =>
    expect(categoryColor("a", tree([["a", { parentId: null, color: null }]]), fallback)).toBe(
      fallback,
    ));
  it("is the colour of a category the tree lacks", () =>
    expect(categoryColor("gone", drinks, fallback)).toBe(fallback));
  it("ends a loop in the data", () => {
    const loop = tree([
      ["a", { parentId: "b", color: null }],
      ["b", { parentId: "a", color: null }],
    ]);
    expect(categoryColor("a", loop, fallback)).toBe(fallback);
  });
  it("loses to the product's own colour and to a coloured category above", () => {
    expect(effectiveColor("#b12525", null, drinks, fallback)).toBe("#b12525");
    expect(effectiveColor(null, "cold", drinks, fallback)).toBe("#256bb1");
  });
});

describe("isStoredColor", () => {
  it("takes lowercase #rrggbb only", () => {
    expect(isStoredColor("#b12525")).toBe(true);
    for (const value of ["#B12525", "#b12", "b12525", "red", "", null, 5])
      expect(isStoredColor(value)).toBe(false);
  });
});
