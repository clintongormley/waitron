import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  THEME_COLOURS,
  THEME_RULES,
  WAITRON_CHOICES,
  colourKey,
  type ThemeChoices,
  type ThemeWarning,
} from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { es, type StringKey } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import {
  advancedSummary,
  againstNames,
  brandFixLabel,
  brandFixedText,
  brandWarningText,
  fixAllText,
  handFixLabel,
  handFixedText,
  handNames,
  handWarningLines,
  keptNote,
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

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
};
const CREAM: ThemeChoices = { ...LUCIA, handSet: { light: { bg: "#f8f1e1" }, dark: {} } };
const SAGE: ThemeChoices = {
  ...LUCIA,
  handSet: { light: { bg: "#f8f1e1", "text-muted": "#8fa898" }, dark: {} },
};
const BLOCKED: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#555555", "surface-sunken": "#555555" }, dark: {} },
};
const HOVER: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { "primary-hover": "#787878" }, dark: {} },
};
const BOTH_WAYS: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: {
    light: { "surface-lifted": "#000000", bg: "#000000", text: "#777777" },
    dark: {},
  },
};

beforeEach(() => {
  setLocale("en-GB");
});

function esFill(key: StringKey, values: Readonly<Record<string, string>>): string {
  return es[key].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

const ES_LIGHT = es["appearance.mode.light"];
const ES_SCREENS = es["appearance.screens.light"];

function esList(names: readonly string[]): string {
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(", ")} ${es["appearance.and"]} ${names.at(-1)!}`;
}

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

  it("words a hand-set warning that has a fix by which side the others are drawn on", () => {
    const sunken = warningOn(TWO_FIXES, "handSet.light.surface-sunken");
    expect(sunken.fix).not.toBeNull();
    expect(saveDialogLine(sunken, TWO_FIXES)).toBe(
      "Sunken areas (light): Text hard to read on it.",
    );
    setLocale("es-ES");
    expect(saveDialogLine(sunken, TWO_FIXES)).toBe(
      esFill("appearance.dialog_under", {
        name: es["appearance.colour.surface-sunken"],
        mode: ES_LIGHT,
        names: es["appearance.colour.text"],
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

  it("words a hand-set warning under its row: the others drawn on it", () => {
    const sage = warningOn(SAGE, "handSet.light.text-muted");
    expect(sage.fix).toBe("#526a5b");
    expect(handWarningLines(sage, SAGE)).toEqual([
      "Light screens: hard to read on Page, Cards, Menus and dialogs, Selected item, Field background, Switched-off field background and the 15 station colours.",
    ]);
    const text = warningOn(TWO_FIXES, "handSet.light.text");
    expect(handWarningLines(text, TWO_FIXES)).toEqual([
      "Light screens: hard to read on Sunken areas, Bar tracks, the 5 zone tab colours and 12 station colours.",
    ]);
    setLocale("es-ES");
    expect(handWarningLines(text, TWO_FIXES)).toEqual([
      esFill("appearance.hand_on", {
        screens: ES_SCREENS,
        names: esList([
          es["appearance.colour.surface-sunken"],
          es["appearance.colour.track"],
          es["appearance.against.tabs_all"],
          esFill("appearance.against.stations", { n: "12" }),
        ]),
      }),
    ]);
  });

  it("words a hand-set warning under its row: it drawn on the others", () => {
    const sunken = warningOn(TWO_FIXES, "handSet.light.surface-sunken");
    expect(handWarningLines(sunken, TWO_FIXES)).toEqual([
      "Light screens: Text hard to read on it.",
    ]);
    setLocale("es-ES");
    expect(handWarningLines(sunken, TWO_FIXES)).toEqual([
      esFill("appearance.hand_under", { screens: ES_SCREENS, names: es["appearance.colour.text"] }),
    ]);
  });

  it("says both sentences for a warning with a fix drawn both ways", () => {
    const hover = warningOn(HOVER, "handSet.light.primary-hover");
    expect(hover.fix).not.toBeNull();
    expect(handWarningLines(hover, HOVER)).toEqual([
      "Light screens: hard to read on Main buttons.",
      "Light screens: Text on main buttons hard to read on it.",
    ]);
    expect(saveDialogLine(hover, HOVER)).toBe(
      "Main buttons, pointed at (light): hard to read on Main buttons. Main buttons, pointed at (light): Text on main buttons hard to read on it.",
    );
    setLocale("es-ES");
    const name = es["appearance.colour.primary-hover"];
    expect(saveDialogLine(hover, HOVER)).toBe(
      `${esFill("appearance.dialog_on", { name, mode: ES_LIGHT, names: es["appearance.colour.primary"] })} ${esFill("appearance.dialog_under", { name, mode: ES_LIGHT, names: es["appearance.colour.on-primary"] })}`,
    );
  });

  it("words a no-fix warning by what blocks it", () => {
    const page = warningOn(SAGE, "handSet.light.bg");
    expect(page.fix).toBeNull();
    expect(handWarningLines(page, SAGE)).toEqual([
      "Light screens: no shade of this colour lets Secondary text be read on it while Secondary text is set by hand to #8fa898.",
    ]);
    const text = warningOn(BLOCKED, "handSet.light.text");
    expect(text.fix).toBeNull();
    expect(handWarningLines(text, BLOCKED)).toEqual([
      "Light screens: no shade of this colour can be read on Sunken areas while Sunken areas is set by hand to #555555.",
    ]);
    expect(handWarningLines({ ...text, blockedBy: [] }, BLOCKED)).toEqual([
      "Light screens: no shade of this colour can be read on Sunken areas. Pick another colour.",
    ]);
    expect(
      handWarningLines(
        { ...text, field: "handSet.light.surface-sunken", against: ["text"], blockedBy: [] },
        BLOCKED,
      ),
    ).toEqual([
      "Light screens: no shade of this colour lets Text be read on it. Pick another colour.",
    ]);
    setLocale("es-ES");
    const sunken = es["appearance.colour.surface-sunken"];
    expect(handWarningLines(text, BLOCKED)).toEqual([
      esFill("appearance.hand_none_on_blocked", {
        screens: ES_SCREENS,
        names: sunken,
        blockers: esFill("appearance.blocker", { name: sunken, colour: "#555555" }),
      }),
    ]);
    expect(handWarningLines({ ...text, blockedBy: [] }, BLOCKED)).toEqual([
      esFill("appearance.hand_none_on", { screens: ES_SCREENS, names: sunken }),
    ]);
    expect(handWarningLines(page, SAGE)).toEqual([
      esFill("appearance.hand_none_under_blocked", {
        screens: ES_SCREENS,
        names: es["appearance.colour.text-muted"],
        blockers: esFill("appearance.blocker", {
          name: es["appearance.colour.text-muted"],
          colour: "#8fa898",
        }),
      }),
    ]);
  });

  it("words the warnings for the colours the guide's Advanced examples use", () => {
    const grey: ThemeChoices = {
      ...WAITRON_CHOICES,
      handSet: { light: { text: "#9a9a9a" }, dark: {} },
    };
    const text = warningOn(grey, "handSet.light.text");
    expect(text.fix).toBe("#585858");
    expect(text.against.slice(0, 2)).toEqual(["bg", "surface"]);
    expect(handWarningLines(text, grey)[0]).toMatch(
      /^Light screens: hard to read on Page, Cards, /,
    );
    expect(handFixLabel(text.fix!)).toBe("Use #585858");
    expect(handFixedText("light", "#9a9a9a")).toBe("Light screens: fixed from #9a9a9a");

    const blocked: ThemeChoices = {
      ...WAITRON_CHOICES,
      handSet: { light: { bg: "#777777", text: "#888888" }, dark: {} },
    };
    const page = warningOn(blocked, "handSet.light.bg");
    expect(page.fix).toBeNull();
    expect(page.blockedBy).toEqual(["text"]);
    expect(handWarningLines(page, blocked).join(" ")).toMatch(
      / while Text is set by hand to #888888\.$/,
    );

    setLocale("es-ES");
    const first = es["appearance.colour.bg"];
    const second = es["appearance.colour.surface"];
    const opening = esFill("appearance.hand_on", {
      screens: ES_SCREENS,
      names: `${first}, ${second}, `,
    }).slice(0, -1);
    expect(handWarningLines(text, grey)[0]!.startsWith(opening)).toBe(true);
    const blocker = esFill("appearance.blocker", {
      name: es["appearance.colour.text"],
      colour: "#888888",
    });
    expect(handWarningLines(page, blocked).join(" ").endsWith(`${blocker}.`)).toBe(true);
  });

  it("says a no-fix warning drawn both ways in one sentence", () => {
    const lifted = warningOn(BOTH_WAYS, "handSet.light.surface-lifted");
    expect(lifted.fix).toBeNull();
    const own = { on: [] as string[], under: [] as string[] };
    for (const key of lifted.against) {
      const on = THEME_RULES.light.some(
        (rule) => colourKey(rule.a) === "surface-lifted" && colourKey(rule.b) === key,
      );
      (on ? own.on : own.under).push(key);
    }
    expect(own.on.length).toBeGreaterThan(0);
    expect(own.under.length).toBeGreaterThan(0);
    expect(handWarningLines(lifted, BOTH_WAYS)).toEqual([
      "Light screens: no shade of this colour can be read on Page and lets Secondary text and Error colour be read on it while Text is set by hand to #777777.",
    ]);
    expect(handWarningLines({ ...lifted, blockedBy: [] }, BOTH_WAYS)).toEqual([
      "Light screens: no shade of this colour can be read on Page and lets Secondary text and Error colour be read on it. Pick another colour.",
    ]);
    setLocale("es-ES");
    const under = esList([es["appearance.colour.text-muted"], es["appearance.against.danger"]]);
    expect(handWarningLines(lifted, BOTH_WAYS)).toEqual([
      esFill("appearance.hand_none_both_blocked", {
        screens: ES_SCREENS,
        on: es["appearance.colour.bg"],
        under,
        blockers: esFill("appearance.blocker", {
          name: es["appearance.colour.text"],
          colour: "#777777",
        }),
      }),
    ]);
    expect(handWarningLines({ ...lifted, blockedBy: [] }, BOTH_WAYS)).toEqual([
      esFill("appearance.hand_none_both", {
        screens: ES_SCREENS,
        on: es["appearance.colour.bg"],
        under,
      }),
    ]);
  });

  it("names every colour a warning can give, never by its key", () => {
    const keys = new Set<string>();
    for (const mode of ["light", "dark"] as const) {
      for (const rule of THEME_RULES[mode]) {
        for (const token of [rule.a, rule.b]) {
          const key = colourKey(token);
          if (!(THEME_COLOURS as readonly string[]).includes(key)) keys.add(key);
        }
      }
    }
    expect(keys.has("table-calm-edge")).toBe(true);
    for (const locale of ["en-GB", "es-ES"]) {
      setLocale(locale);
      for (const key of [...keys, ...THEME_COLOURS]) {
        const name = againstNames([key]);
        expect(name.trim()).not.toBe("");
        expect(name).not.toBe(key);
        expect(name).not.toContain("appearance.");
      }
    }
    setLocale("en-GB");
    expect(againstNames(["station-red"])).toBe("1 station colour");
    expect(againstNames(["station-red-dot"])).toBe("1 station dot");
    expect(againstNames(["tab-bill-tint"])).toBe("1 zone tab colour");
    const dots = [...keys].filter((key) => key.endsWith("-dot"));
    expect(dots).toHaveLength(15);
    expect(againstNames(dots)).toBe("the 15 station dots");
    expect(againstNames(["bg", "surface", "station-red", "station-blue"])).toBe(
      "Page, Cards and 2 station colours",
    );
    expect(againstNames(["warning", "highlight"])).toBe("Warning colour and Search highlight");
    setLocale("es-ES");
    expect(againstNames(["station-red"])).toBe(es["appearance.against.stations_one"]);
    expect(againstNames(dots)).toBe(es["appearance.against.dots_all"]);
    expect(againstNames(["tab-bill-tint", "tab-ready-tint"])).toBe(
      esFill("appearance.against.tabs", { n: "2" }),
    );
    expect(againstNames(["station-red-dot", "station-blue-dot"])).toBe(
      esFill("appearance.against.dots", { n: "2" }),
    );
  });

  it("names the colours set by hand, light first", () => {
    expect(handNames(WAITRON_CHOICES)).toEqual([]);
    const both: ThemeChoices = {
      ...SAGE,
      handSet: { light: SAGE.handSet.light, dark: { text: "#eeeeee" } },
    };
    expect(handNames(both)).toEqual(["Page (light)", "Secondary text (light)", "Text (dark)"]);
    setLocale("es-ES");
    expect(handNames(CREAM)).toEqual([
      esFill("appearance.hand_item", { name: es["appearance.colour.bg"], mode: ES_LIGHT }),
    ]);
  });

  it("sums up Advanced when it is closed", () => {
    const summary = (choices: ThemeChoices) =>
      advancedSummary(choices, deriveTheme(choices).warnings);
    expect(summary(WAITRON_CHOICES)).toBe(
      "None set by hand. Waitron works out every colour and text size.",
    );
    expect(summary(LEMON)).toBe("None set by hand. Waitron works out every colour and text size.");
    expect(deriveTheme(LEMON).warnings.length).toBeGreaterThan(0);
    expect(summary(CREAM)).toBe("1 set by hand: Page (light)");
    expect(summary(SAGE)).toBe(
      "2 set by hand: Page (light), Secondary text (light) · 2 hard to read",
    );
    const sage = warningOn(SAGE, "handSet.light.text-muted");
    expect(advancedSummary(SAGE, [sage])).toBe(
      "2 set by hand: Page (light), Secondary text (light) · 1 hard to read",
    );
    setLocale("es-ES");
    const names = [
      esFill("appearance.hand_item", { name: es["appearance.colour.bg"], mode: ES_LIGHT }),
      esFill("appearance.hand_item", { name: es["appearance.colour.text-muted"], mode: ES_LIGHT }),
    ];
    expect(summary(WAITRON_CHOICES)).toBe(es["appearance.advanced_none"]);
    expect(summary(CREAM)).toBe(esFill("appearance.advanced_set_one", { names: names[0]! }));
    expect(summary(SAGE)).toBe(
      `${esFill("appearance.advanced_set", { n: "2", names: names.join(", ") })} · ${esFill("appearance.hard_to_read_count", { count: "2" })}`,
    );
  });

  it("notes the colours set by hand that a brand or background change keeps", () => {
    expect(keptNote(WAITRON_CHOICES)).toBe("");
    expect(keptNote(CREAM)).toBe(
      "You set 1 colour by hand, and it is kept: Page (light). Advanced shows it.",
    );
    expect(keptNote(SAGE)).toBe(
      "You set 2 colours by hand, and they are kept: Page (light), Secondary text (light). Advanced shows them.",
    );
    setLocale("es-ES");
    const page = esFill("appearance.hand_item", {
      name: es["appearance.colour.bg"],
      mode: ES_LIGHT,
    });
    expect(keptNote(CREAM)).toBe(esFill("appearance.kept_one", { name: page }));
    expect(keptNote(SAGE)).toBe(
      esFill("appearance.kept_many", {
        n: "2",
        names: `${page}, ${esFill("appearance.hand_item", { name: es["appearance.colour.text-muted"], mode: ES_LIGHT })}`,
      }),
    );
  });

  it("words a row's fix and the fixed line", () => {
    expect(handFixLabel("#526a5b")).toBe("Use #526a5b");
    expect(handFixedText("light", "#8fa898")).toBe("Light screens: fixed from #8fa898");
    expect(handFixedText("dark", "#8fa898")).toBe("Dark screens: fixed from #8fa898");
    setLocale("es-ES");
    expect(handFixLabel("#526a5b")).toBe(esFill("appearance.hand_fix", { colour: "#526a5b" }));
    expect(handFixedText("dark", "#8fa898")).toBe(
      esFill("appearance.hand_fixed", {
        screens: es["appearance.screens.dark"],
        colour: "#8fa898",
      }),
    );
  });
});
