import { describe, expect, it } from "vitest";
import type { TextScale } from "./tokens.js";
import { WAITRON_DEFAULTS } from "./waitron.js";
import {
  drawnSize,
  isTextSize,
  normaliseText,
  sameText,
  TEXT_SIZE_KEYS,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_WEIGHT_KEYS,
  TEXT_WEIGHTS,
  TYPEFACES,
  textTokens,
  type Typeface,
  typefaceStack,
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

describe("typefaceStack", () => {
  it("the device's own is Waitron's own typeface", () => {
    expect(typefaceStack("system", WAITRON_DEFAULTS)).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family"],
    );
    expect(WAITRON_DEFAULTS.structure["--wt-font-family"]).toBe(
      'system-ui, -apple-system, "Segoe UI", sans-serif',
    );
  });

  it("serif is the serif stack", () => {
    expect(typefaceStack("serif", WAITRON_DEFAULTS)).toBe(
      'ui-serif, Georgia, "Times New Roman", serif',
    );
  });

  it("follows the defaults it is given", () => {
    const defaults = {
      ...WAITRON_DEFAULTS,
      structure: { ...WAITRON_DEFAULTS.structure, "--wt-font-family": "Arial" },
    };
    expect(typefaceStack("system", defaults)).toBe("Arial");
    expect(typefaceStack("serif", defaults)).toBe('ui-serif, Georgia, "Times New Roman", serif');
  });

  it("refuses a missing or empty default typeface", () => {
    const withoutFamily: Record<string, string> = { ...WAITRON_DEFAULTS.structure };
    delete withoutFamily["--wt-font-family"];
    for (const structure of [
      withoutFamily,
      { ...WAITRON_DEFAULTS.structure, "--wt-font-family": "" },
    ]) {
      expect(() => typefaceStack("system", { ...WAITRON_DEFAULTS, structure })).toThrow(
        new RangeError("no default typeface: --wt-font-family"),
      );
    }
    expect(typefaceStack("serif", { ...WAITRON_DEFAULTS, structure: withoutFamily })).toBe(
      'ui-serif, Georgia, "Times New Roman", serif',
    );
  });

  it("refuses a typeface it does not name", () => {
    expect(() => typefaceStack("cursive" as Typeface, WAITRON_DEFAULTS)).toThrow(
      new RangeError("not a typeface: cursive"),
    );
  });
});

describe("drawnSize", () => {
  it.each<[TextScale, [number, number, number, number]]>([
    [100, [12, 14, 18, 22]],
    [105, [13, 15, 19, 23]],
    [110, [13, 15, 20, 24]],
    [115, [14, 16, 21, 25]],
    [120, [14, 17, 22, 26]],
    [125, [15, 18, 23, 28]],
    [130, [16, 18, 23, 29]],
  ])("at %i%% Waitron's sizes round half up to whole pixels", (step, expected) => {
    expect([12, 14, 18, 22].map((px) => drawnSize(px, step))).toEqual(expected);
  });

  it("a hand-set size is scaled the same way", () => {
    expect(drawnSize(25, 130)).toBe(33);
    expect(drawnSize(8, 130)).toBe(10);
    expect(drawnSize(9, 105)).toBe(9);
    expect(drawnSize(14, 115)).toBe(16);
  });
});

describe("textTokens", () => {
  it("with nothing set by hand, answers Waitron's sizes, typeface and weights", () => {
    expect(textTokens(100, {}, WAITRON_DEFAULTS)).toEqual({
      "--wt-font-size-sm": "12px",
      "--wt-font-size-md": "14px",
      "--wt-font-size-lg": "18px",
      "--wt-font-size-xl": "22px",
      "--wt-font-family": 'system-ui, -apple-system, "Segoe UI", sans-serif',
      "--wt-font-weight-normal": "400",
      "--wt-font-weight-medium": "500",
      "--wt-font-weight-bold": "600",
    });
  });

  it("a hand-set part replaces only its own token, and the sizes scale", () => {
    expect(
      textTokens(
        115,
        { family: "serif", size: { lg: 25 }, weight: { normal: 700, bold: 800 } },
        WAITRON_DEFAULTS,
      ),
    ).toEqual({
      "--wt-font-size-sm": "14px",
      "--wt-font-size-md": "16px",
      "--wt-font-size-lg": "29px",
      "--wt-font-size-xl": "25px",
      "--wt-font-family": 'ui-serif, Georgia, "Times New Roman", serif',
      "--wt-font-weight-normal": "700",
      "--wt-font-weight-medium": "500",
      "--wt-font-weight-bold": "800",
    });
  });

  it("refuses a default weight that is not a whole hundred", () => {
    for (const value of ["450", "0", "1000", "bold", "600;", "x600", "600px", ""]) {
      const defaults = {
        ...WAITRON_DEFAULTS,
        structure: { ...WAITRON_DEFAULTS.structure, "--wt-font-weight-medium": value },
      };
      expect(() => textTokens(100, {}, defaults), value).toThrow(
        new RangeError("not a whole-hundred weight: --wt-font-weight-medium"),
      );
    }
    const withoutBold: Record<string, string> = { ...WAITRON_DEFAULTS.structure };
    delete withoutBold["--wt-font-weight-bold"];
    expect(() => textTokens(100, {}, { ...WAITRON_DEFAULTS, structure: withoutBold })).toThrow(
      new RangeError("not a whole-hundred weight: --wt-font-weight-bold"),
    );
  });
});
