import { describe, expect, test } from "vitest";
import { relativeLuminance } from "./colour.js";
import {
  CONTRAST_GROUPS,
  THEME_RULES,
  allRules,
  checkRules,
  failureLabels,
  passes,
  rulesIn,
  type ContrastGroupId,
  type ContrastRule,
} from "./contrast-rules.js";
import { MODES } from "./defaults.js";
import { THEME_COLOURS, colourToken } from "./tokens.js";
import { WAITRON_DEFAULTS } from "./waitron.js";

const SIZES: Record<ContrastGroupId, readonly [light: number, dark: number]> = {
  "lifted-surface": [6, 6],
  "sunken-surface": [1, 1],
  "bar-track": [3, 3],
  field: [10, 10],
  "primary-text": [4, 4],
  "search-highlight": [2, 2],
  "hover-text": [2, 2],
  "hover-shows": [2, 2],
  "disabled-fill": [0, 4],
  "disabled-text": [0, 2],
  "google-button": [5, 5],
  "calendar-text": [18, 18],
  "calendar-days": [1, 1],
  "table-text": [5, 5],
  "table-dots": [2, 2],
  "calm-edge": [2, 2],
  "station-text": [60, 60],
  "station-dots": [240, 240],
  "station-focus": [16, 16],
  "button-text": [1, 1],
  "button-fill": [2, 2],
  "focus-ring": [2, 2],
};

const colourOf = (mode: "light" | "dark") => (token: string) => {
  const value = WAITRON_DEFAULTS[mode][token];
  if (value === undefined) throw new Error(`no ${token} in ${mode}`);
  return value;
};

describe("the rule groups", () => {
  test("are the table's groups, in its order", () => {
    expect(CONTRAST_GROUPS.map((group) => group.id)).toEqual(Object.keys(SIZES));
  });

  for (const [index, mode] of MODES.entries()) {
    test(`each group holds the table's count of ${mode} rules`, () => {
      const sizes = Object.fromEntries(
        CONTRAST_GROUPS.map((group) => [group.id, rulesIn(group.id, mode).length]),
      );
      expect(sizes).toEqual(
        Object.fromEntries(Object.entries(SIZES).map(([id, counts]) => [id, counts[index]])),
      );
      for (const rule of allRules(mode)) {
        expect(rulesIn(rule.group, mode)).toContain(rule);
      }
    });
  }

  test("all the rules, in table order", () => {
    expect(allRules("light")).toHaveLength(384);
    expect(allRules("dark")).toHaveLength(390);
    expect(allRules("dark")).toEqual(CONTRAST_GROUPS.flatMap((group) => rulesIn(group.id, "dark")));
  });

  test("the disabled groups are dark only", () => {
    const disabled = CONTRAST_GROUPS.filter((group) => group.modes.length === 1);
    expect(disabled.map((group) => [group.id, group.modes])).toEqual([
      ["disabled-fill", ["dark"]],
      ["disabled-text", ["dark"]],
    ]);
  });

  test("a few rules read as the table says", () => {
    expect(rulesIn("lifted-surface", "light")[0]).toEqual({
      group: "lifted-surface",
      a: "--wt-color-surface-lifted",
      b: "--wt-color-bg",
      kind: "above",
      need: 1.1,
    });
    expect(rulesIn("disabled-fill", "dark")[0]).toEqual({
      group: "disabled-fill",
      a: "--wt-color-primary-disabled",
      b: "--wt-color-surface",
      kind: "at-most",
      need: 1.5,
    });
    expect(rulesIn("station-dots", "light")[15]).toEqual({
      group: "station-dots",
      a: "--wt-color-station-red-dot",
      b: "--wt-color-surface",
      kind: "at-least",
      need: 3,
    });
    expect(rulesIn("calendar-text", "dark")[17]).toEqual({
      group: "calendar-text",
      a: "--wt-color-on-day-closed",
      b: "--wt-color-day-closed",
      kind: "at-least",
      need: 4.5,
    });
  });

  test("every rule names tokens Waitron declares in each mode it applies to", () => {
    for (const mode of MODES) {
      for (const rule of allRules(mode)) {
        expect(WAITRON_DEFAULTS[mode], rule.a).toHaveProperty([rule.a]);
        expect(WAITRON_DEFAULTS[mode], rule.b).toHaveProperty([rule.b]);
      }
    }
  });
});

describe.each(MODES)("Waitron's own palette (%s)", (mode) => {
  test("passes every rule", () => {
    expect(failureLabels(checkRules(allRules(mode), colourOf(mode)))).toEqual([]);
  });

  test("every rule bites", () => {
    const own = colourOf(mode);
    for (const rule of allRules(mode)) {
      const b = own(rule.b);
      const breaking =
        rule.kind === "at-most" ? (relativeLuminance(b) > 0.18 ? "#000000" : "#ffffff") : b;
      const [result] = checkRules([rule], (token) => (token === rule.a ? breaking : own(token)));
      expect(result!.pass, `${rule.a} / ${rule.b}`).toBe(false);
    }
  });
});

describe("the rules naming a colour the theme writes", () => {
  const themeTokens = new Set<string>(THEME_COLOURS.map(colourToken));
  test.each([
    ["light", 100],
    ["dark", 105],
  ] as const)("%s", (mode, count) => {
    expect(THEME_RULES[mode]).toEqual(
      allRules(mode).filter((rule) => themeTokens.has(rule.a) || themeTokens.has(rule.b)),
    );
    expect(THEME_RULES[mode]).toHaveLength(count);
  });
});

describe("passes", () => {
  const rule = (kind: ContrastRule["kind"], need: number): ContrastRule => ({
    group: "field",
    a: "--wt-color-text",
    b: "--wt-color-bg",
    kind,
    need,
  });

  test("at least passes at the bound and fails below it", () => {
    expect(passes(rule("at-least", 4.5), 4.5)).toBe(true);
    expect(passes(rule("at-least", 4.5), 4.49)).toBe(false);
  });

  test("above fails at the bound and passes over it", () => {
    expect(passes(rule("above", 1.1), 1.1)).toBe(false);
    expect(passes(rule("above", 1.1), 1.11)).toBe(true);
  });

  test("at most passes at the bound and fails over it", () => {
    expect(passes(rule("at-most", 1.5), 1.5)).toBe(true);
    expect(passes(rule("at-most", 1.5), 1.51)).toBe(false);
  });
});

describe("checkRules and failureLabels", () => {
  const atLeast: ContrastRule = {
    group: "bar-track",
    a: "--wt-color-text",
    b: "--wt-color-track",
    kind: "at-least",
    need: 4.5,
  };
  const atMost: ContrastRule = { ...atLeast, kind: "at-most", need: 1.5 };
  const above: ContrastRule = { ...atLeast, kind: "above", need: 1.1 };
  const colours: Record<string, string> = {
    "--wt-color-text": "#767676",
    "--wt-color-track": "#ffffff",
  };

  test("a result carries its rule, its ratio and whether it passed", () => {
    const [result] = checkRules([atLeast], (token) => colours[token]!);
    expect(result!.rule).toBe(atLeast);
    expect(result!.ratio).toBeCloseTo(4.54, 2);
    expect(result!.pass).toBe(true);
  });

  test("a failing result is labelled with its ratio and bound, a passing one not at all", () => {
    const results = checkRules([atLeast, atMost, above], (token) => colours[token]!);
    expect(failureLabels(results)).toEqual([
      "--wt-color-text on --wt-color-track: 4.54, needs at most 1.5",
    ]);
    expect(
      failureLabels([
        { rule: atLeast, ratio: 4.214, pass: false },
        { rule: above, ratio: 1.1, pass: false },
      ]),
    ).toEqual([
      "--wt-color-text on --wt-color-track: 4.21, needs at least 4.5",
      "--wt-color-text on --wt-color-track: 1.10, needs more than 1.1",
    ]);
  });
});
