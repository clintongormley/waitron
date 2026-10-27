import { describe, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "./theme.js";
import { TEXT_SCALES, type TextScale } from "./tokens.js";
import { WAITRON_DEFAULTS } from "./waitron.js";
import {
  drawnSize,
  drawnTextSize,
  isTextWarning,
  TEXT_FLOOR_PX,
  textLimit,
  textNotes,
  textWarnings,
  withTextFixes,
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

const withSizes = (
  textScale: TextScale,
  size: NonNullable<ThemeChoices["text"]["size"]>,
): ThemeChoices => ({ ...WAITRON_CHOICES, textScale, text: { size } });

describe("text warnings", () => {
  it("the floor is 12 px", () => {
    expect(TEXT_FLOOR_PX).toBe(12);
  });

  it.each(TEXT_SCALES)("Waitron's own theme never warns, at %i%%", (textScale) => {
    expect(textWarnings({ ...WAITRON_CHOICES, textScale }, WAITRON_DEFAULTS)).toEqual([]);
  });

  it("Small text set by hand to 10 at 100% warns, offering 12", () => {
    expect(textWarnings(withSizes(100, { sm: 10 }), WAITRON_DEFAULTS)).toEqual([
      { field: "text.size.sm", mode: null, against: [], fix: 12, blockedBy: [] },
    ]);
  });

  it("at 130%, Small text set by hand to 8 draws 10 px and the fix offers 9", () => {
    const choices = withSizes(130, { sm: 8 });
    expect(drawnTextSize(choices, "sm", WAITRON_DEFAULTS)).toBe(10);
    expect(textWarnings(choices, WAITRON_DEFAULTS).map((w) => w.fix)).toEqual([9]);
    const fixed = withSizes(130, { sm: 9 });
    expect(drawnTextSize(fixed, "sm", WAITRON_DEFAULTS)).toBe(12);
    expect(textWarnings(fixed, WAITRON_DEFAULTS)).toEqual([]);
  });

  it("an unset size draws Waitron's own size at the step", () => {
    expect(drawnTextSize(withSizes(130, {}), "md", WAITRON_DEFAULTS)).toBe(18);
    expect(drawnTextSize(withSizes(100, { sm: 9 }), "md", WAITRON_DEFAULTS)).toBe(14);
  });

  it.each([
    [100, 9, 12],
    [105, 9, 11],
    [110, 10, 11],
    [115, 10, 10],
    [120, 11, 10],
    [125, 11, 10],
  ] as const)(
    "a Small text fixed to 9 warns again at %i%%: draws %i px, offers %i",
    (textScale, drawn, fix) => {
      const choices = withSizes(textScale, { sm: 9 });
      expect(drawnTextSize(choices, "sm", WAITRON_DEFAULTS)).toBe(drawn);
      expect(textWarnings(choices, WAITRON_DEFAULTS)).toEqual([
        { field: "text.size.sm", mode: null, against: [], fix, blockedBy: [] },
      ]);
    },
  );

  it("a Small text fixed to 9 at 130% draws 12 px and does not warn", () => {
    const choices = withSizes(130, { sm: 9 });
    expect(drawnTextSize(choices, "sm", WAITRON_DEFAULTS)).toBe(12);
    expect(textWarnings(choices, WAITRON_DEFAULTS)).toEqual([]);
  });

  it("a size drawing exactly 12 px does not warn, and 11 px does", () => {
    expect(textWarnings(withSizes(100, { sm: 12 }), WAITRON_DEFAULTS)).toEqual([]);
    expect(textWarnings(withSizes(100, { sm: 11 }), WAITRON_DEFAULTS).map((w) => w.fix)).toEqual([
      12,
    ]);
  });

  it("warns in the order sm, md, lg, xl", () => {
    const choices = withSizes(100, { xl: 8, md: 9, lg: 10, sm: 11 });
    expect(textWarnings(choices, WAITRON_DEFAULTS).map((w) => w.field)).toEqual([
      "text.size.sm",
      "text.size.md",
      "text.size.lg",
      "text.size.xl",
    ]);
  });

  it.each([400, 800] as const)("a weight or a typeface never warns: Serif at %i", (weight) => {
    const choices: ThemeChoices = {
      ...WAITRON_CHOICES,
      text: { family: "serif", weight: { normal: weight, medium: weight, bold: weight } },
    };
    expect(textWarnings(choices, WAITRON_DEFAULTS)).toEqual([]);
  });

  it("taking the fixes leaves no text warning and touches nothing else", () => {
    const choices: ThemeChoices = {
      ...withSizes(100, { sm: 10, md: 9, lg: 30 }),
      brandColor: "#f2d300",
      text: { family: "serif", size: { sm: 10, md: 9, lg: 30 }, weight: { bold: 800 } },
    };
    const fixed = withTextFixes(choices, WAITRON_DEFAULTS);
    expect(fixed).toEqual({
      ...choices,
      text: { family: "serif", size: { sm: 12, md: 12, lg: 30 }, weight: { bold: 800 } },
    });
    expect(textWarnings(fixed, WAITRON_DEFAULTS)).toEqual([]);
  });

  it("taking no fixes answers the same choices", () => {
    const choices = withSizes(100, { lg: 30 });
    expect(withTextFixes(choices, WAITRON_DEFAULTS)).toBe(choices);
  });

  it("tells a text warning from a colour one by its mode", () => {
    expect(isTextWarning({ mode: null })).toBe(true);
    expect(isTextWarning({ mode: "light" })).toBe(false);
    expect(isTextWarning({ mode: "dark" })).toBe(false);
  });
});

describe("larger than checked", () => {
  it("the limits are Waitron's sizes at 130%", () => {
    expect(TEXT_SIZE_KEYS.map((key) => textLimit(key, WAITRON_DEFAULTS))).toEqual([16, 18, 23, 29]);
  });

  it("at 130%, Largest text set by hand to 25 draws 33 px and the fix offers 22, which draws 29", () => {
    expect(textNotes(withSizes(130, { xl: 25 }), WAITRON_DEFAULTS)).toEqual([
      { key: "xl", drawn: 33, fix: 22 },
    ]);
    expect(drawnTextSize(withSizes(130, { xl: 22 }), "xl", WAITRON_DEFAULTS)).toBe(29);
    expect(textNotes(withSizes(130, { xl: 22 }), WAITRON_DEFAULTS)).toEqual([]);
    expect(drawnTextSize(withSizes(130, { xl: 23 }), "xl", WAITRON_DEFAULTS)).toBe(30);
    expect(textNotes(withSizes(130, { xl: 23 }), WAITRON_DEFAULTS)).toEqual([
      { key: "xl", drawn: 30, fix: 22 },
    ]);
  });

  it("at 100% the fix is the limit itself", () => {
    expect(textNotes(withSizes(100, { sm: 17, md: 40 }), WAITRON_DEFAULTS)).toEqual([
      { key: "sm", drawn: 17, fix: 16 },
      { key: "md", drawn: 40, fix: 18 },
    ]);
    expect(textNotes(withSizes(100, { sm: 16 }), WAITRON_DEFAULTS)).toEqual([]);
  });

  it.each(TEXT_SCALES)("Waitron's own sizes get no note, at %i%%", (textScale) => {
    expect(textNotes({ ...WAITRON_CHOICES, textScale }, WAITRON_DEFAULTS)).toEqual([]);
  });

  it("a note is never a warning", () => {
    expect(textWarnings(withSizes(130, { xl: 25 }), WAITRON_DEFAULTS)).toEqual([]);
  });

  it("a missing default size is refused", () => {
    const structure: Record<string, string> = { ...WAITRON_DEFAULTS.structure };
    delete structure["--wt-font-size-lg"];
    expect(() => textLimit("lg", { ...WAITRON_DEFAULTS, structure })).toThrow(
      new RangeError("not a whole-pixel size: --wt-font-size-lg"),
    );
  });

  it.each(["1rem", "x12px", "12pxx"])("a default size of %s is refused", (value) => {
    const structure = { ...WAITRON_DEFAULTS.structure, "--wt-font-size-sm": value };
    expect(() => textLimit("sm", { ...WAITRON_DEFAULTS, structure })).toThrow(
      new RangeError("not a whole-pixel size: --wt-font-size-sm"),
    );
  });
});
