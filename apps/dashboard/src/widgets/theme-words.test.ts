import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  THEME_COLOURS,
  WAITRON_CHOICES,
  type ThemeChoices,
  type ThemeWarning,
} from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { es, type StringKey } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import {
  brandFixLabel,
  brandFixedText,
  brandWarningText,
  fixAllText,
  saveDialogLine,
  savedWarningLine,
  themeColourName,
} from "./theme-words.js";

const LEMON: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };
const TWO_FIXES: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
};
const OUTLASTS: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#aaaaaa", "surface-sunken": "#555555" }, dark: {} },
};

function warningOn(choices: ThemeChoices, field: ThemeWarning["field"]): ThemeWarning {
  const found = deriveTheme(choices).warnings.find((warning) => warning.field === field);
  if (found === undefined) throw new Error(`no warning on ${field}`);
  return found;
}

const NO_SHADE: ThemeWarning = {
  field: "handSet.light.text",
  mode: "light",
  against: ["surface-sunken"],
  fix: null,
  blockedBy: [],
};

const TWO_BLOCKERS: ThemeWarning = { ...NO_SHADE, blockedBy: ["bg", "surface-sunken"] };
const TWO_BLOCKERS_CHOICES: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#aaaaaa", bg: "#666666", "surface-sunken": "#555555" }, dark: {} },
};

beforeEach(() => {
  setLocale("en-GB");
});

function esFill(key: StringKey, values: Readonly<Record<string, string>>): string {
  return es[key].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

const ES_LIGHT = es["appearance.mode.light"];

afterEach(() => {
  setLocale("en-GB");
});

describe("theme words", () => {
  it("words the editor's brand warning, its fix and the taken fix", () => {
    expect(brandWarningText("light")).toBe(
      "Buttons in this colour are hard to see on light screens.",
    );
    expect(brandFixLabel("light", "#9d8a15")).toBe("Use #9d8a15 on light screens");
    expect(brandFixedText("dark", "#437e5b")).toBe("Buttons on dark screens: #437e5b");
    setLocale("es-ES");
    expect(brandWarningText("light")).toBe(es["appearance.brand_warning_light"]);
    expect(brandFixLabel("light", "#9d8a15")).toBe(
      esFill("appearance.brand_fix_light", { colour: "#9d8a15" }),
    );
    expect(brandFixedText("dark", "#437e5b")).toBe(
      esFill("appearance.brand_fixed_dark", { colour: "#437e5b" }),
    );
  });

  it("words the dark brand warning and fix too", () => {
    expect(brandWarningText("dark")).toBe(
      "Buttons in this colour are hard to see on dark screens.",
    );
    expect(brandFixLabel("dark", "#437e5b")).toBe("Use #437e5b on dark screens");
    expect(brandFixedText("light", "#9d8a15")).toBe("Buttons on light screens: #9d8a15");
  });

  it("counts the colours that are hard to read", () => {
    expect(fixAllText(2)).toBe("2 colours are hard to read.");
    setLocale("es-ES");
    expect(fixAllText(2)).toBe(esFill("appearance.fix_all_count", { n: "2" }));
  });

  it("words the save dialog's line for a brand warning", () => {
    const lemon = warningOn(LEMON, "brandColor");
    expect(saveDialogLine(lemon, LEMON)).toBe(
      "Brand colour: buttons are hard to see on light screens.",
    );
    expect(saveDialogLine({ ...lemon, mode: "dark" }, LEMON)).toBe(
      "Brand colour: buttons are hard to see on dark screens.",
    );
    setLocale("es-ES");
    expect(saveDialogLine(lemon, LEMON)).toBe(es["appearance.dialog_brand_light"]);
  });

  it("words a hand-set warning that has a fix with the saved card's sentence", () => {
    const sunken = warningOn(TWO_FIXES, "handSet.light.surface-sunken");
    expect(sunken.fix).not.toBeNull();
    expect(saveDialogLine(sunken, TWO_FIXES)).toBe("Sunken areas (light) is hard to read.");
    setLocale("es-ES");
    expect(saveDialogLine(sunken, TWO_FIXES)).toBe(
      esFill("appearance.hard_to_read", {
        name: es["appearance.colour.surface-sunken"],
        mode: ES_LIGHT,
      }),
    );
  });

  it("names the hand-set colour that blocks every shade, with its colour", () => {
    const text = warningOn(OUTLASTS, "handSet.light.text");
    expect(text.fix).toBeNull();
    expect(text.blockedBy).toEqual(["surface-sunken"]);
    expect(saveDialogLine(text, OUTLASTS)).toBe(
      "Text (light): no shade can be read while Sunken areas is set by hand to #555555.",
    );
    setLocale("es-ES");
    expect(saveDialogLine(text, OUTLASTS)).toBe(
      esFill("appearance.dialog_blocked", {
        name: es["appearance.colour.text"],
        mode: ES_LIGHT,
        blockers: esFill("appearance.blocker", {
          name: es["appearance.colour.surface-sunken"],
          colour: "#555555",
        }),
      }),
    );
  });

  it("says no shade can be read when nothing set by hand blocks it", () => {
    expect(saveDialogLine(NO_SHADE, OUTLASTS)).toBe("Text (light): no shade can be read.");
    setLocale("es-ES");
    expect(saveDialogLine(NO_SHADE, OUTLASTS)).toBe(
      esFill("appearance.dialog_no_shade", { name: es["appearance.colour.text"], mode: ES_LIGHT }),
    );
  });

  it("joins two blockers with and", () => {
    expect(saveDialogLine(TWO_BLOCKERS, TWO_BLOCKERS_CHOICES)).toBe(
      "Text (light): no shade can be read while Page is set by hand to #666666 and Sunken areas is set by hand to #555555.",
    );
    setLocale("es-ES");
    const page = esFill("appearance.blocker", {
      name: es["appearance.colour.bg"],
      colour: "#666666",
    });
    const sunken = esFill("appearance.blocker", {
      name: es["appearance.colour.surface-sunken"],
      colour: "#555555",
    });
    expect(saveDialogLine(TWO_BLOCKERS, TWO_BLOCKERS_CHOICES)).toBe(
      esFill("appearance.dialog_blocked", {
        name: es["appearance.colour.text"],
        mode: ES_LIGHT,
        blockers: `${page} ${es["appearance.and"]} ${sunken}`,
      }),
    );
  });

  it("words the saved card's warnings", () => {
    const lemon = warningOn(LEMON, "brandColor");
    expect(savedWarningLine(lemon)).toBe(
      "Buttons in the brand colour are hard to see on light screens.",
    );
    expect(savedWarningLine({ ...lemon, mode: "dark" })).toBe(
      "Buttons in the brand colour are hard to see on dark screens.",
    );
    const sunken = warningOn(TWO_FIXES, "handSet.light.surface-sunken");
    expect(savedWarningLine(sunken)).toBe("Sunken areas (light) is hard to read.");
    expect(savedWarningLine({ ...NO_SHADE, field: "handSet.dark.bg", mode: "dark" })).toBe(
      "Page (dark) is hard to read.",
    );
    setLocale("es-ES");
    expect(savedWarningLine(lemon)).toBe(es["appearance.saved_brand_light"]);
    expect(savedWarningLine(sunken)).toBe(
      esFill("appearance.hard_to_read", {
        name: es["appearance.colour.surface-sunken"],
        mode: ES_LIGHT,
      }),
    );
  });

  it("gives each of the 22 theme colours its own plain name in both languages", () => {
    expect(THEME_COLOURS).toHaveLength(22);
    for (const locale of ["en-GB", "es-ES"]) {
      setLocale(locale);
      const names = THEME_COLOURS.map((key) => themeColourName(key));
      for (const name of names) expect(name.trim()).not.toBe("");
      expect(new Set(names).size).toBe(THEME_COLOURS.length);
    }
    setLocale("en-GB");
    expect(themeColourName("bg")).toBe("Page");
    expect(themeColourName("stepper-button")).toBe("+ and − buttons");
    setLocale("es-ES");
    expect(themeColourName("bg")).toBe(es["appearance.colour.bg"]);
    expect(themeColourName("stepper-button")).toBe(es["appearance.colour.stepper-button"]);
  });
});
