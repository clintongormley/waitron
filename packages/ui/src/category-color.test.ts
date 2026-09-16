// packages/ui/src/category-color.test.ts
import { expect, test } from "vitest";
import { readableTextColor, CATEGORY_PALETTE, isHexColor } from "./category-color.js";

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = hex
      .replace("#", "")
      .match(/../g)!
      .map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

test("palette is 24 lower-case six-digit hex values", () => {
  expect(CATEGORY_PALETTE).toHaveLength(24);
  for (const c of CATEGORY_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
});

test("palette keeps eight hues in dark-to-pale blocks", () => {
  expect(CATEGORY_PALETTE).toEqual([
    "#b12525",
    "#dd5f5f",
    "#edabab",
    "#b16b25",
    "#dd9e5f",
    "#edccab",
    "#b1b125",
    "#dddd5f",
    "#ededab",
    "#25b125",
    "#5fdd5f",
    "#abedab",
    "#25b19a",
    "#5fddc8",
    "#abede2",
    "#256bb1",
    "#5f9edd",
    "#abcced",
    "#5425b1",
    "#895fdd",
    "#c1abed",
    "#b125b1",
    "#dd5fdd",
    "#edabed",
  ]);
});

test("every palette colour gets readable text (>= 4.5:1)", () => {
  for (const c of CATEGORY_PALETTE)
    expect(contrast(c, readableTextColor(c))).toBeGreaterThanOrEqual(4.5);
});

test("the whole RGB cube gets readable text at a coarse step", () => {
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        const hex = "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
        expect(contrast(hex, readableTextColor(hex))).toBeGreaterThanOrEqual(4.5);
      }
});

test("isHexColor accepts #rrggbb lower case only", () => {
  expect(isHexColor("#dd9e5f")).toBe(true);
  expect(isHexColor("#DD9E5F")).toBe(false);
  expect(isHexColor("dd9e5f")).toBe(false);
  expect(isHexColor("#fff")).toBe(false);
  expect(isHexColor("")).toBe(false);
});
