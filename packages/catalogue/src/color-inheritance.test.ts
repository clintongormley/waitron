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
    expect(effectiveColor("#b12525", "juice", drinks)).toBe("#b12525"));
  it("takes the main category's colour when the product has none", () =>
    expect(effectiveColor(null, "juice", drinks)).toBe("#25b125"));
  it("takes the nearest coloured category above an uncoloured one, two levels up", () =>
    expect(effectiveColor(null, "cold", drinks)).toBe("#256bb1"));
  it("is null for an uncategorised product and when nothing above is coloured", () => {
    expect(effectiveColor(null, null, drinks)).toBeNull();
    expect(categoryColor("a", tree([["a", { parentId: null, color: null }]]))).toBeNull();
  });
  it("ends at null for a category the tree lacks and for a loop in the data", () => {
    expect(categoryColor("gone", drinks)).toBeNull();
    const loop = tree([
      ["a", { parentId: "b", color: null }],
      ["b", { parentId: "a", color: null }],
    ]);
    expect(categoryColor("a", loop)).toBeNull();
  });
});

describe("isStoredColor", () => {
  it("takes lowercase #rrggbb only", () => {
    expect(isStoredColor("#b12525")).toBe(true);
    for (const value of ["#B12525", "#b12", "b12525", "red", "", null, 5])
      expect(isStoredColor(value)).toBe(false);
  });
});
