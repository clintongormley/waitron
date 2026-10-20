import { expect, test } from "vitest";
import { THEME_RULES, checkRules } from "./contrast-rules.js";
import { MODES, type Mode } from "./defaults.js";
import {
  canFixAll,
  fixAll,
  WAITRON_CHOICES,
  type DerivedTheme,
  type ThemeChoices,
  type ThemeWarning,
} from "./theme.js";
import { colourToken, THEME_COLOURS, type ThemeColour } from "./tokens.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const PRIMARY = colourToken("primary");
const CORNERS = [
  "#000000",
  "#0000ff",
  "#00ff00",
  "#00ffff",
  "#ff0000",
  "#ff00ff",
  "#ffff00",
  "#ffffff",
];
const DARK_GREEN_FIXED: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
  brandFix: { dark: true },
};

const withHand = (mode: Mode, values: Partial<Record<ThemeColour, string>>): ThemeChoices => ({
  ...DARK_GREEN_FIXED,
  handSet: { ...DARK_GREEN_FIXED.handSet, [mode]: values },
});

const failingRules = (theme: DerivedTheme, mode: Mode) =>
  checkRules(
    THEME_RULES[mode],
    (token) => (theme[mode][token] ?? WAITRON_DEFAULTS[mode][token])!,
  ).filter((result) => !result.pass);

/** Failing rules naming neither a colour set by hand nor the brand colour. */
function unexplained(theme: DerivedTheme, choices: ThemeChoices, mode: Mode) {
  const named = new Set([PRIMARY, ...Object.keys(choices.handSet[mode]).map(colourToken)]);
  return failingRules(theme, mode).filter(({ rule }) => !named.has(rule.a) && !named.has(rule.b));
}

const keyOf = (warning: ThemeWarning) => warning.field.split(".")[2] as ThemeColour;

const single = {
  light: { cases: 0, noWarning: 0, handWarned: 0 },
  dark: { cases: 0, noWarning: 0, handWarned: 0 },
  noFix: 0,
  unexplained: 0,
  failingAfterFixAll: 0,
};

for (const mode of MODES) {
  for (const colour of THEME_COLOURS) {
    test(`${mode} ${colour} set by hand to each corner of the colour cube: every warning has a fix, and Fix all clears it`, () => {
      for (const value of CORNERS) {
        const choices = withHand(mode, { [colour]: value });
        const theme = deriveTheme(choices);
        single[mode].cases++;
        const stray = unexplained(theme, choices, mode);
        if (stray.length > 0) single.unexplained++;
        expect(stray, value).toEqual([]);
        expect(
          theme.warnings.filter((warning) => warning.field === "brandColor"),
          value,
        ).toEqual([]);
        if (theme.warnings.length === 0) single[mode].noWarning++;
        else single[mode].handWarned++;
        for (const warning of theme.warnings) {
          if (warning.fix === null) single.noFix++;
          expect(warning.fix, value).not.toBeNull();
        }
        const fixed = deriveTheme(fixAll(WAITRON_DEFAULTS, choices));
        const left = failingRules(fixed, mode);
        if (fixed.warnings.length > 0 || left.length > 0) single.failingAfterFixAll++;
        expect(fixed.warnings, value).toEqual([]);
        expect(left, value).toEqual([]);
      }
    });
  }
}

// Reads the totals the tests above collect, so it holds only when every one of them ran first, in order.
test("the one-colour sweep's totals match the reference's", () => {
  expect(single).toEqual({
    light: { cases: 176, noWarning: 87, handWarned: 89 },
    dark: { cases: 176, noWarning: 78, handWarned: 98 },
    noFix: 0,
    unexplained: 0,
    failingAfterFixAll: 0,
  });
});

const PAIRS: readonly (readonly [ThemeColour, ThemeColour])[] = [
  ["text", "surface-sunken"],
  ["text", "track"],
  ["field-value", "field-fill"],
  ["text-muted", "field-fill-disabled"],
  ["primary-text", "bg"],
  ["field-line", "surface"],
  ["focus", "surface-lifted"],
  ["track", "bg"],
];
const GREYS = ["#555555", "#aaaaaa"];

const pairs = {
  cases: 0,
  warnings: 0,
  noFix: 0,
  unexplained: 0,
  fixLeavesItsWarning: 0,
  fixLeftAfterFixAll: 0,
  unexplainedAfterFixAll: 0,
  stillWarningAfterFixAll: 0,
  offeredEveryWarningFixed: 0,
  offeredByFixAllAlone: 0,
  notOffered: 0,
};

for (const [a, b] of PAIRS) {
  test(`light ${a} and ${b} set by hand to greys: each fix clears its own warning, and Fix all leaves none with a fix`, () => {
    for (const ca of GREYS) {
      for (const cb of GREYS) {
        const label = `${a}=${ca} ${b}=${cb}`;
        const hand = { [a]: ca, [b]: cb };
        const choices = withHand("light", hand);
        const theme = deriveTheme(choices);
        pairs.cases++;
        const stray = unexplained(theme, choices, "light");
        if (stray.length > 0) pairs.unexplained++;
        expect(stray, label).toEqual([]);
        for (const warning of theme.warnings) {
          pairs.warnings++;
          if (warning.fix === null) {
            pairs.noFix++;
            continue;
          }
          const alone = deriveTheme(withHand("light", { ...hand, [keyOf(warning)]: warning.fix }));
          const kept = alone.warnings.some((other) => other.field === warning.field);
          if (kept) pairs.fixLeavesItsWarning++;
          expect(kept, `${label} ${warning.field}`).toBe(false);
        }

        const all = fixAll(WAITRON_DEFAULTS, choices);
        const after = deriveTheme(all);
        if (after.warnings.some((warning) => warning.fix !== null)) pairs.fixLeftAfterFixAll++;
        expect(
          after.warnings.filter((warning) => warning.fix !== null),
          label,
        ).toEqual([]);
        const strayAfter = unexplained(after, all, "light");
        if (strayAfter.length > 0) pairs.unexplainedAfterFixAll++;
        expect(strayAfter, label).toEqual([]);
        if (after.warnings.length > 0) pairs.stillWarningAfterFixAll++;

        const offered = canFixAll(WAITRON_DEFAULTS, choices);
        expect(offered, label).toBe(after.warnings.length === 0);
        if (!offered) pairs.notOffered++;
        else if (theme.warnings.every((warning) => warning.fix !== null)) {
          pairs.offeredEveryWarningFixed++;
        } else pairs.offeredByFixAllAlone++;
      }
    }
  });
}

// Reads the totals the tests above collect, so it holds only when every one of them ran first, in order.
test("the two-colour sweep's totals match the reference's", () => {
  expect(pairs).toEqual({
    cases: 32,
    warnings: 61,
    noFix: 20,
    unexplained: 0,
    fixLeavesItsWarning: 0,
    fixLeftAfterFixAll: 0,
    unexplainedAfterFixAll: 0,
    stillWarningAfterFixAll: 7,
    offeredEveryWarningFixed: 15,
    offeredByFixAllAlone: 10,
    notOffered: 7,
  });
});
