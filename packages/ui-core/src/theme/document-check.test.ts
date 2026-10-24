import { describe, expect, it } from "vitest";
import { readThemeDocument, THEME_DOCUMENT_KEYS } from "./document-check.js";
import { BACKGROUNDS, WAITRON_CHOICES } from "./theme.js";
import { CORNER_CHOICES, TEXT_SCALES } from "./tokens.js";

const L = "a".repeat(64) + ".webp";
const D = "b".repeat(64) + ".png";

const withoutBrand: Record<string, unknown> = { ...WAITRON_CHOICES };
delete withoutBrand.brandColor;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe("readThemeDocument", () => {
  it("names the document's keys and the allowed choices", () => {
    expect(THEME_DOCUMENT_KEYS).toEqual([
      "brandColor",
      "brandFix",
      "background",
      "corners",
      "handSet",
      "logo",
      "textScale",
    ]);
    expect(TEXT_SCALES).toEqual([100, 105, 110, 115, 120, 125, 130]);
    expect(BACKGROUNDS).toEqual(["neutral", "tinted"]);
    expect(CORNER_CHOICES).toEqual(["square", "standard", "round"]);
  });

  it("accepts Waitron's own choices", () => {
    expect(readThemeDocument(WAITRON_CHOICES)).toEqual({ ok: true, choices: WAITRON_CHOICES });
  });

  it("accepts no logo, a logo, and a logo with a version for dark screens", () => {
    for (const logo of [null, { light: L }, { light: L, dark: D }, { light: "" }]) {
      expect(readThemeDocument({ ...WAITRON_CHOICES, logo })).toEqual({
        ok: true,
        choices: { ...WAITRON_CHOICES, logo },
      });
    }
  });

  it("carries only a logo's own pictures, never an inherited dark one", () => {
    const logo = Object.assign(Object.create({ dark: 7 }), { light: L });
    const result = readThemeDocument({ ...WAITRON_CHOICES, logo });
    expect(result).toEqual({ ok: true, choices: { ...WAITRON_CHOICES, logo: { light: L } } });
    expect(result.ok && result.choices.logo?.dark).toBeUndefined();
  });

  it("reads a document without a logo key as no logo", () => {
    const { logo: _, ...noLogo } = WAITRON_CHOICES;
    void _;
    expect(readThemeDocument(noLogo)).toEqual({ ok: true, choices: WAITRON_CHOICES });
    expect(readThemeDocument({ ...WAITRON_CHOICES, logo: undefined })).toEqual({
      ok: true,
      choices: WAITRON_CHOICES,
    });
  });

  it("accepts every text size", () => {
    for (const textScale of TEXT_SCALES) {
      expect(readThemeDocument({ ...WAITRON_CHOICES, textScale })).toEqual({
        ok: true,
        choices: { ...WAITRON_CHOICES, textScale },
      });
    }
  });

  it("reads a document without a text size as 100", () => {
    const { textScale: _, ...noTextScale } = WAITRON_CHOICES;
    void _;
    expect(readThemeDocument(noTextScale)).toEqual({ ok: true, choices: WAITRON_CHOICES });
    expect(readThemeDocument({ ...WAITRON_CHOICES, textScale: undefined })).toEqual({
      ok: true,
      choices: WAITRON_CHOICES,
    });
  });

  it.each<unknown>([112, 95, 135, 0, 100.5, "115", null, true, [115]])(
    "refuses a text size off the list (%j)",
    (textScale) => {
      expect(readThemeDocument({ ...WAITRON_CHOICES, textScale })).toEqual({
        ok: false,
        field: "textScale",
        reason: "bad_value",
      });
    },
  );

  it("accepts every background and corner choice", () => {
    for (const background of BACKGROUNDS) {
      for (const corners of CORNER_CHOICES) {
        expect(readThemeDocument({ ...WAITRON_CHOICES, background, corners })).toEqual({
          ok: true,
          choices: { ...WAITRON_CHOICES, background, corners },
        });
      }
    }
  });

  it("accepts the dark-green brand (#1e5b3a) with fixes and hand-set colours in both modes", () => {
    const sent = {
      brandColor: "#1e5b3a",
      brandFix: { light: true, dark: true },
      background: "tinted",
      corners: "round",
      handSet: { light: { bg: "#f8f1e1", text: "#101010" }, dark: { surface: "#202020" } },
      logo: null,
      textScale: 100,
    };
    expect(readThemeDocument(sent)).toEqual({ ok: true, choices: sent });
  });

  it("lower-cases hex on the way in", () => {
    const result = readThemeDocument({
      ...WAITRON_CHOICES,
      brandColor: "#F2D300",
      handSet: { light: { bg: "#F8F1E1" }, dark: {} },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices.brandColor).toBe("#f2d300");
    expect(result.choices.handSet.light.bg).toBe("#f8f1e1");
  });

  it.each<[unknown, string, string]>([
    [null, "theme", "not_object"],
    [[], "theme", "not_object"],
    ["theme", "theme", "not_object"],
    [{ ...WAITRON_CHOICES, logo: "a.webp" }, "logo", "bad_value"],
    [{ ...WAITRON_CHOICES, logo: [] }, "logo", "bad_value"],
    [{ ...WAITRON_CHOICES, logo: 7 }, "logo", "bad_value"],
    [{ ...WAITRON_CHOICES, logo: { light: L, size: 1 } }, "logo", "unknown_key"],
    [{ ...WAITRON_CHOICES, logo: { dark: D } }, "logo.dark", "dark_without_light"],
    [{ ...WAITRON_CHOICES, logo: { dark: null } }, "logo.dark", "dark_without_light"],
    [{ ...WAITRON_CHOICES, logo: { dark: 7 } }, "logo.dark", "dark_without_light"],
    [{ ...WAITRON_CHOICES, logo: {} }, "logo.light", "missing"],
    [{ ...WAITRON_CHOICES, logo: Object.create({ light: L }) }, "logo.light", "missing"],
    [{ ...WAITRON_CHOICES, logo: Object.create({ dark: D }) }, "logo.light", "missing"],
    [{ ...WAITRON_CHOICES, logo: { light: 7 } }, "logo.light", "bad_value"],
    [{ ...WAITRON_CHOICES, logo: { light: null } }, "logo.light", "bad_value"],
    [{ ...WAITRON_CHOICES, logo: { light: L, dark: null } }, "logo.dark", "bad_value"],
    [{ ...WAITRON_CHOICES, logo: { light: L, dark: 7 } }, "logo.dark", "bad_value"],
    [{ ...WAITRON_CHOICES, notAThemeKey: 110 }, "theme", "unknown_key"],
    [{ ...WAITRON_CHOICES, textScale: 1 }, "textScale", "bad_value"],
    [{ ...WAITRON_CHOICES, textScale: 112 }, "textScale", "bad_value"],
    [{ ...WAITRON_CHOICES, text: {} }, "theme", "unknown_key"],
    [{ ...WAITRON_CHOICES, printedLogo: null }, "theme", "unknown_key"],
    [withoutBrand, "brandColor", "missing"],
    [{ ...WAITRON_CHOICES, brandColor: "#abc" }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: "1e5b3a" }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: "#1e5b3a0" }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: "x#1e5b3a" }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: "#1g5b3a" }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: "red" }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: 7 }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: ["#1e5b3a"] }, "brandColor", "bad_value"],
    [{ ...WAITRON_CHOICES, brandColor: undefined }, "brandColor", "missing"],
    [{ ...WAITRON_CHOICES, brandFix: undefined }, "brandFix", "missing"],
    [{ ...WAITRON_CHOICES, brandFix: [] }, "brandFix", "bad_value"],
    [{ ...WAITRON_CHOICES, brandFix: null }, "brandFix", "bad_value"],
    [{ ...WAITRON_CHOICES, brandFix: true }, "brandFix", "bad_value"],
    [{ ...WAITRON_CHOICES, brandFix: { sepia: true } }, "brandFix", "unknown_key"],
    [{ ...WAITRON_CHOICES, brandFix: { light: false } }, "brandFix.light", "bad_value"],
    [{ ...WAITRON_CHOICES, brandFix: { dark: "true" } }, "brandFix.dark", "bad_value"],
    [{ ...WAITRON_CHOICES, background: undefined }, "background", "missing"],
    [{ ...WAITRON_CHOICES, background: "grey" }, "background", "bad_value"],
    [{ ...WAITRON_CHOICES, corners: undefined }, "corners", "missing"],
    [{ ...WAITRON_CHOICES, corners: "pill" }, "corners", "bad_value"],
    [{ ...WAITRON_CHOICES, handSet: undefined }, "handSet", "missing"],
    [{ ...WAITRON_CHOICES, handSet: [] }, "handSet", "bad_value"],
    [{ ...WAITRON_CHOICES, handSet: null }, "handSet", "bad_value"],
    [{ ...WAITRON_CHOICES, handSet: { light: {} } }, "handSet.dark", "missing"],
    [{ ...WAITRON_CHOICES, handSet: { dark: {} } }, "handSet.light", "missing"],
    [{ ...WAITRON_CHOICES, handSet: { light: {}, dark: {}, sepia: {} } }, "handSet", "unknown_key"],
    [{ ...WAITRON_CHOICES, handSet: { light: [], dark: {} } }, "handSet.light", "bad_value"],
    [{ ...WAITRON_CHOICES, handSet: { light: {}, dark: null } }, "handSet.dark", "bad_value"],
    [
      { ...WAITRON_CHOICES, handSet: { light: { scrim: "#000000" }, dark: {} } },
      "handSet.light",
      "unknown_colour",
    ],
    [
      { ...WAITRON_CHOICES, handSet: { light: { danger: "#ff0000" }, dark: {} } },
      "handSet.light",
      "unknown_colour",
    ],
    [
      { ...WAITRON_CHOICES, handSet: { light: { bg: "#fff" }, dark: {} } },
      "handSet.light.bg",
      "bad_value",
    ],
    [
      { ...WAITRON_CHOICES, handSet: { light: {}, dark: { text: 0 } } },
      "handSet.dark.text",
      "bad_value",
    ],
    [
      { ...WAITRON_CHOICES, brandColor: null, brandFix: { light: true } },
      "brandFix.light",
      "fix_without_brand",
    ],
    [
      { ...WAITRON_CHOICES, brandColor: null, brandFix: { dark: true } },
      "brandFix.dark",
      "fix_without_brand",
    ],
    [
      {
        ...WAITRON_CHOICES,
        brandColor: "#1e5b3a",
        brandFix: { dark: true },
        handSet: { light: {}, dark: { primary: "#5fa77a" } },
      },
      "brandFix.dark",
      "fix_with_hand_set",
    ],
    [
      {
        ...WAITRON_CHOICES,
        brandColor: "#1e5b3a",
        brandFix: { light: true },
        handSet: { light: { primary: "#5fa77a" }, dark: {} },
      },
      "brandFix.light",
      "fix_with_hand_set",
    ],
  ])("refuses each malformed part, naming its field (%j)", (sent, field, reason) => {
    expect(readThemeDocument(sent)).toEqual({ ok: false, field, reason });
  });

  it("answers the first refusal in its fixed order", () => {
    expect(readThemeDocument({ ...WAITRON_CHOICES, logo: 7, textScale: 112 })).toEqual({
      ok: false,
      field: "logo",
      reason: "bad_value",
    });
    expect(readThemeDocument({ ...WAITRON_CHOICES, brandFix: { light: true }, logo: 7 })).toEqual({
      ok: false,
      field: "brandFix.light",
      reason: "fix_without_brand",
    });
    expect(readThemeDocument({ ...WAITRON_CHOICES, logo: "a.webp", brandColor: "red" })).toEqual({
      ok: false,
      field: "brandColor",
      reason: "bad_value",
    });
    expect(readThemeDocument({ ...WAITRON_CHOICES, logo: { dark: D }, handSet: null })).toEqual({
      ok: false,
      field: "handSet",
      reason: "bad_value",
    });
    expect(readThemeDocument({ ...WAITRON_CHOICES, brandColor: "red", corners: "pill" })).toEqual({
      ok: false,
      field: "brandColor",
      reason: "bad_value",
    });
    expect(readThemeDocument({ ...WAITRON_CHOICES, a: 1, b: 2 })).toEqual({
      ok: false,
      field: "theme",
      reason: "unknown_key",
    });
    expect(
      readThemeDocument({
        ...WAITRON_CHOICES,
        brandFix: { light: false },
        background: "grey",
      }),
    ).toEqual({ ok: false, field: "brandFix.light", reason: "bad_value" });
    expect(readThemeDocument({ ...WAITRON_CHOICES, background: "grey", corners: "pill" })).toEqual({
      ok: false,
      field: "background",
      reason: "bad_value",
    });
    expect(readThemeDocument({ ...WAITRON_CHOICES, corners: "pill", handSet: null })).toEqual({
      ok: false,
      field: "corners",
      reason: "bad_value",
    });
    expect(
      readThemeDocument({
        ...WAITRON_CHOICES,
        brandColor: null,
        brandFix: { light: true },
        handSet: { light: { bg: "#fff" }, dark: {} },
      }),
    ).toEqual({ ok: false, field: "handSet.light.bg", reason: "bad_value" });
    expect(
      readThemeDocument({
        ...WAITRON_CHOICES,
        brandColor: null,
        brandFix: { light: true, dark: true },
      }),
    ).toEqual({ ok: false, field: "brandFix.light", reason: "fix_without_brand" });
    expect(
      readThemeDocument({
        ...WAITRON_CHOICES,
        handSet: { light: { scrim: "#000000", bg: "#fff" }, dark: { scrim: "#000000" } },
      }),
    ).toEqual({ ok: false, field: "handSet.light", reason: "unknown_colour" });
  });

  it("accepts a fix beside a hand-set colour other than Main buttons", () => {
    const sent = {
      ...WAITRON_CHOICES,
      brandColor: "#1e5b3a",
      brandFix: { dark: true },
      handSet: { light: {}, dark: { bg: "#000000" } },
    };
    expect(readThemeDocument(sent)).toEqual({ ok: true, choices: sent });
  });

  it("never mutates its input", () => {
    const sent = deepFreeze({
      ...WAITRON_CHOICES,
      brandColor: "#F2D300",
      brandFix: { light: true },
      handSet: { light: { bg: "#F8F1E1" }, dark: {} },
      logo: { light: L, dark: D },
    });
    expect(readThemeDocument(sent).ok).toBe(true);
    expect(sent.brandColor).toBe("#F2D300");
    const { logo: _, ...noLogo } = WAITRON_CHOICES;
    void _;
    const frozenWithoutLogo = deepFreeze({ ...noLogo });
    expect(readThemeDocument(frozenWithoutLogo)).toEqual({ ok: true, choices: WAITRON_CHOICES });
  });
});
