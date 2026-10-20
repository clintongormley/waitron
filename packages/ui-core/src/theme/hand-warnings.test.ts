import { describe, expect, test } from "vitest";
import { contrastRatio } from "./colour.js";
import { THEME_RULES, checkRules } from "./contrast-rules.js";
import type { Mode, WaitronDefaults } from "./defaults.js";
import {
  canFixAll,
  deriveThemeFrom,
  fixAll,
  WAITRON_CHOICES,
  type DerivedTheme,
  type ThemeChoices,
} from "./theme.js";
import { colourToken, type ThemeColour } from "./tokens.js";
import { groupAgainst } from "./warnings.js";
import { WAITRON_DEFAULTS } from "./waitron.js";

const P = colourToken;
const ratio = (a: string, b: string) => contrastRatio(a, b).toFixed(2);

const STATIONS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
];
const STATION_FILLS = STATIONS.map((station) => `station-${station}`);
const STATION_DOTS = STATIONS.map((station) => `station-${station}-dot`);

const DARK_GREEN_FIXED: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
  brandFix: { dark: true },
};

const withHand = (
  choices: ThemeChoices,
  mode: Mode,
  values: Partial<Record<ThemeColour, string>>,
): ThemeChoices => ({ ...choices, handSet: { ...choices.handSet, [mode]: values } });

const handLight = (values: Partial<Record<ThemeColour, string>>) =>
  withHand(DARK_GREEN_FIXED, "light", values);

/** Derives, and holds every case of this file to: a warning with a fix names no blocker. */
function derive(choices: ThemeChoices, defaults: WaitronDefaults = WAITRON_DEFAULTS): DerivedTheme {
  const theme = deriveThemeFrom(defaults, choices);
  for (const warning of theme.warnings) {
    if (warning.fix !== null) expect(warning.blockedBy, warning.field).toEqual([]);
  }
  return theme;
}

const failingIn = (theme: DerivedTheme, mode: Mode) =>
  checkRules(
    THEME_RULES[mode],
    (token) => (theme[mode][token] ?? WAITRON_DEFAULTS[mode][token])!,
  ).filter((result) => !result.pass);

describe("a colour set by hand that is hard to read", () => {
  test("the sage secondary text (#8fa898) on the cream page (#f8f1e1) warns, and its fix reads", () => {
    const sage = handLight({ bg: "#f8f1e1", "text-muted": "#8fa898" });
    const theme = derive(sage);
    expect(theme.warnings).toEqual([
      {
        field: "handSet.light.text-muted",
        mode: "light",
        against: ["surface-lifted", "field-fill", "field-fill-disabled", ...STATION_FILLS],
        fix: "#526a5b",
        blockedBy: [],
      },
    ]);
    expect(
      ["surface-lifted", "field-fill", "field-fill-disabled"].map((key) =>
        ratio("#8fa898", theme.light[P(key)]!),
      ),
    ).toEqual(["2.04", "2.24", "2.38"]);
    expect(theme.tintStrength?.light).toBe(1);
    expect(theme.light[P("field-fill")]).toBe("#ebf2ed");
    expect(groupAgainst(theme.warnings[0]!.against)).toEqual([
      { kind: "colour", key: "surface-lifted" },
      { kind: "colour", key: "field-fill" },
      { kind: "colour", key: "field-fill-disabled" },
      { kind: "station-fills", count: 15 },
    ]);

    const fixed = derive(handLight({ bg: "#f8f1e1", "text-muted": "#526a5b" }));
    expect(fixed.warnings).toEqual([]);
    expect(
      ["surface-lifted", "field-fill", "field-fill-disabled"].map((key) =>
        ratio("#526a5b", fixed.light[P(key)]!),
      ),
    ).toEqual(["4.70", "5.17", "5.49"]);
    const onStations = STATION_FILLS.map((key) =>
      contrastRatio("#526a5b", WAITRON_DEFAULTS.light[P(key)]!),
    );
    expect(Math.min(...onStations).toFixed(2)).toBe("4.54");
    expect(Math.max(...onStations).toFixed(2)).toBe("5.11");
  });

  test("pure blue cards (#0000ff) warn against 22 colours, and their fix clears every rule", () => {
    const theme = derive(handLight({ surface: "#0000ff" }));
    expect(theme.warnings).toHaveLength(1);
    const warning = theme.warnings[0]!;
    expect(warning).toMatchObject({ field: "handSet.light.surface", fix: "#e2ecff" });
    expect(warning.against).toHaveLength(22);
    expect(warning.against).toEqual(expect.arrayContaining(STATION_DOTS));
    expect(groupAgainst(warning.against)).toEqual([
      { kind: "colour", key: "field-line" },
      { kind: "colour", key: "primary-text" },
      { kind: "colour", key: "google-button-line" },
      { kind: "colour", key: "success" },
      { kind: "colour", key: "danger" },
      { kind: "station-dots", count: 15 },
      { kind: "colour", key: "primary" },
      { kind: "colour", key: "focus" },
    ]);

    const fixed = derive(handLight({ surface: "#e2ecff" }));
    expect(fixed.warnings).toEqual([]);
    expect(failingIn(fixed, "light")).toEqual([]);
  });

  test("two colours set by hand failing one rule each get a fix of their own", () => {
    const hand = { text: "#6a6a6a", "surface-sunken": "#bbbbbb" } as const;
    const theme = derive(handLight(hand));
    expect(theme.warnings.map(({ field, fix }) => [field, fix])).toEqual([
      ["handSet.light.surface-sunken", "#ebebeb"],
      ["handSet.light.text", "#4a4a4a"],
    ]);
    const text = theme.warnings.find((warning) => warning.field === "handSet.light.text")!;
    expect(text.against).toEqual(expect.arrayContaining(["surface-sunken", "track"]));
    expect(groupAgainst(text.against)).toEqual([
      { kind: "colour", key: "surface-sunken" },
      { kind: "colour", key: "track" },
      { kind: "station-fills", count: 12 },
    ]);

    expect(derive(handLight({ ...hand, text: "#4a4a4a" })).warnings).toEqual([]);
    expect(
      derive(handLight({ ...hand, "surface-sunken": "#ebebeb" })).warnings.map(({ field, fix }) => [
        field,
        fix,
      ]),
    ).toEqual([["handSet.light.text", "#5b5b5b"]]);

    const all = fixAll(WAITRON_DEFAULTS, handLight(hand));
    expect(all.handSet.light).toEqual({ text: "#4a4a4a", "surface-sunken": "#bbbbbb" });
    expect(derive(all).warnings).toEqual([]);
  });

  test("a rule between the brand colour and black cards (#000000) is the cards' warning only", () => {
    const theme = derive(handLight({ surface: "#000000" }));
    expect(theme.warnings).toHaveLength(1);
    expect(theme.warnings[0]).toMatchObject({ field: "handSet.light.surface", fix: "#ebebeb" });
    expect(theme.warnings[0]!.against).toContain("primary");
  });

  test("black dark cards (#000000) move for no meaning colour", () => {
    expect(derive(withHand(DARK_GREEN_FIXED, "dark", { surface: "#000000" })).warnings).toEqual([
      {
        field: "handSet.dark.surface",
        mode: "dark",
        against: ["danger-disabled"],
        fix: "#040404",
        blockedBy: [],
      },
    ]);
  });

  test("Waitron's brand with dark Main buttons #7a1f2b warns on the buttons", () => {
    expect(derive(withHand(WAITRON_CHOICES, "dark", { primary: "#7a1f2b" })).warnings).toEqual([
      {
        field: "handSet.dark.primary",
        mode: "dark",
        against: ["field-fill", "bg", "surface"],
        fix: "#9e4048",
        blockedBy: [],
      },
    ]);
  });
});

describe("what blocks a colour set by hand that no shade fixes", () => {
  test("grey secondary text (#808080) on a black disabled field (#000000) is blocked by the field", () => {
    const theme = derive(handLight({ "text-muted": "#808080", "field-fill-disabled": "#000000" }));
    expect(theme.warnings).toHaveLength(1);
    expect(theme.warnings[0]).toMatchObject({
      field: "handSet.light.text-muted",
      fix: null,
      blockedBy: ["field-fill-disabled"],
    });
    expect(theme.warnings[0]!.against).toHaveLength(17);

    const alone = derive(handLight({ "text-muted": "#808080" }));
    expect(alone.warnings).toHaveLength(1);
    expect(alone.warnings[0]).toMatchObject({ field: "handSet.light.text-muted", fix: "#636363" });
    expect(alone.warnings[0]!.against).toHaveLength(18);
  });

  test("light text (#aaaaaa) on black sunken areas (#000000) is blocked by the sunken areas", () => {
    const theme = derive(handLight({ text: "#aaaaaa", "surface-sunken": "#000000" }));
    expect(theme.warnings.map(({ field, fix, blockedBy }) => [field, fix, blockedBy])).toEqual([
      ["handSet.light.text", null, ["surface-sunken"]],
    ]);
  });

  test("light text (#aaaaaa) on black sunken areas and bar tracks is blocked by both together", () => {
    const theme = derive(
      handLight({ text: "#aaaaaa", "surface-sunken": "#000000", track: "#000000" }),
    );
    expect(theme.warnings.map(({ field, fix, blockedBy }) => [field, fix, blockedBy])).toEqual([
      ["handSet.light.text", null, ["surface-sunken", "track"]],
    ]);
  });

  test("with nothing else set by hand, a text no shade fixes names no blocker", () => {
    const contrived: WaitronDefaults = {
      ...WAITRON_DEFAULTS,
      light: {
        ...WAITRON_DEFAULTS.light,
        [P("station-red")]: "#000000",
        [P("station-orange")]: "#ffffff",
      },
    };
    const theme = derive(handLight({ text: "#808080" }), contrived);
    expect(theme.warnings.map(({ field, fix, blockedBy }) => [field, fix, blockedBy])).toEqual([
      ["handSet.light.text", null, []],
    ]);
  });
});

describe("Fix and save", () => {
  test("is offered when Fix all clears a warning that has no fix of its own", () => {
    const choices = handLight({ text: "#555555", "surface-sunken": "#555555" });
    expect(
      derive(choices).warnings.map(({ field, fix, blockedBy }) => [field, fix, blockedBy]),
    ).toEqual([
      ["handSet.light.surface-sunken", "#cacaca", []],
      ["handSet.light.text", null, ["surface-sunken"]],
    ]);
    expect(canFixAll(WAITRON_DEFAULTS, choices)).toBe(true);
    const all = fixAll(WAITRON_DEFAULTS, choices);
    expect(all.handSet.light).toEqual({ text: "#555555", "surface-sunken": "#cacaca" });
    expect(derive(all).warnings).toEqual([]);
  });

  test("is not offered when a warning outlasts Fix all", () => {
    const choices = handLight({ text: "#aaaaaa", "surface-sunken": "#555555" });
    expect(derive(choices).warnings.map(({ field, fix }) => [field, fix])).toEqual([
      ["handSet.light.surface-sunken", "#3d3d3d"],
      ["handSet.light.text", null],
    ]);
    expect(canFixAll(WAITRON_DEFAULTS, choices)).toBe(false);
    const after = derive(fixAll(WAITRON_DEFAULTS, choices));
    expect(after.warnings.map(({ field, fix, blockedBy }) => [field, fix, blockedBy])).toEqual([
      ["handSet.light.text", null, ["surface-sunken"]],
    ]);
  });
});

describe("the brand colour's fix beside colours set by hand", () => {
  test("a hand-set colour keeps its fix while the brand colour as picked warns", () => {
    const lemon: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };
    const brandAlone = derive(lemon).warnings;
    expect(brandAlone.map(({ field, fix }) => [field, fix])).toEqual([["brandColor", "#9f8b18"]]);

    const theme = derive(withHand(lemon, "light", { "text-muted": "#8fa898" }));
    expect(theme.warnings.map(({ field, fix }) => [field, fix])).toEqual([
      ["brandColor", "#9f8b18"],
      ["handSet.light.text-muted", "#526a5b"],
    ]);
    expect(theme.warnings[0]).toEqual(brandAlone[0]);

    const fixed = derive(withHand(lemon, "light", { "text-muted": "#526a5b" }));
    expect(fixed.warnings).toEqual(brandAlone);
  });

  test("offers the button colour its fix flag paints, against colours not set by hand", () => {
    const choices = withHand({ ...WAITRON_CHOICES, brandColor: "#000000" }, "dark", {
      "field-value": "#2c2c2c",
      "field-line": "#000001",
      border: "#0d121c",
    });
    expect(derive(choices).warnings).toEqual([
      {
        field: "brandColor",
        mode: "dark",
        against: ["field-fill", "bg", "surface"],
        fix: "#737373",
        blockedBy: [],
      },
      {
        field: "handSet.dark.field-line",
        mode: "dark",
        against: ["field-fill", "surface", "bg"],
        fix: "#585e6a",
        blockedBy: [],
      },
      {
        field: "handSet.dark.field-value",
        mode: "dark",
        against: ["field-fill"],
        fix: "#777777",
        blockedBy: [],
      },
    ]);
    expect(derive({ ...choices, brandFix: { dark: true } }).dark[P("primary")]).toBe("#737373");
  });
});

describe("groupAgainst", () => {
  test("keeps colours in place and counts station fills and dots where each first appears", () => {
    expect(
      groupAgainst(["text", "station-red-dot", "station-red", "bg", "station-blue-dot"]),
    ).toEqual([
      { kind: "colour", key: "text" },
      { kind: "station-dots", count: 2 },
      { kind: "station-fills", count: 1 },
      { kind: "colour", key: "bg" },
    ]);
    expect(groupAgainst([])).toEqual([]);
  });
});
