import { describe, expect, it } from "vitest";
import {
  isTextSize,
  normaliseText,
  sameText,
  TEXT_SIZE_KEYS,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_WEIGHT_KEYS,
  TEXT_WEIGHTS,
  TYPEFACES,
} from "./text.js";

describe("text set by hand", () => {
  it("names the typefaces, sizes and weights", () => {
    expect(TYPEFACES).toEqual(["system", "serif"]);
    expect(TEXT_SIZE_KEYS).toEqual(["sm", "md", "lg", "xl"]);
    expect(TEXT_WEIGHT_KEYS).toEqual(["normal", "medium", "bold"]);
    expect(TEXT_WEIGHTS).toEqual([400, 500, 600, 700, 800]);
    expect([TEXT_SIZE_MIN, TEXT_SIZE_MAX]).toEqual([8, 40]);
  });

  it("a text size is a whole number from 8 to 40", () => {
    for (const value of [8, 12, 40]) expect(isTextSize(value)).toBe(true);
    for (const value of [7, 41, 12.5, "12", null, Number.NaN]) {
      expect(isTextSize(value)).toBe(false);
    }
  });

  it("normalising drops empty parts and orders the keys", () => {
    expect(normaliseText({ size: {}, weight: {} })).toEqual({});
    expect(Object.keys(normaliseText({ size: {}, weight: {} }))).toEqual([]);
    const sent = { weight: { bold: 800 }, size: { xl: 25, sm: 9 }, family: "serif" } as const;
    const answer = normaliseText(sent);
    expect(answer).toEqual(sent);
    expect(Object.keys(answer)).toEqual(["family", "size", "weight"]);
    expect(Object.keys(answer.size ?? {})).toEqual(["sm", "xl"]);
    expect(
      Object.keys(normaliseText({ weight: { bold: 700, normal: 400, medium: 500 } }).weight ?? {}),
    ).toEqual(["normal", "medium", "bold"]);
    expect(normaliseText({ family: "system" })).toEqual({ family: "system" });
  });

  it("two texts are the same by value", () => {
    expect(sameText({ size: {} }, {})).toBe(true);
    expect(sameText({ size: { sm: 9, xl: 20 } }, { size: { xl: 20, sm: 9 } })).toBe(true);
    expect(sameText({ size: { sm: 9 } }, { size: { sm: 10 } })).toBe(false);
    expect(sameText({ family: "system" }, {})).toBe(false);
    expect(sameText({ weight: { bold: 700 } }, { weight: { bold: 800 } })).toBe(false);
    expect(sameText({ weight: { bold: 700 } }, { weight: { medium: 700 } })).toBe(false);
  });
});
