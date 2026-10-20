import { expect, test } from "vitest";
import { THEME_RULES, checkRules } from "./contrast-rules.js";
import { MODES, type Mode } from "./defaults.js";
import { type Background, WAITRON_CHOICES, type DerivedTheme } from "./theme.js";
import { colourToken, THEME_TOKENS } from "./tokens.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const PRIMARY = colourToken("primary");
const STEPS = [0, 51, 102, 153, 204, 255];
const hex = (value: number) => value.toString(16).padStart(2, "0");
const BRANDS = STEPS.flatMap((r) =>
  STEPS.flatMap((g) => STEPS.map((b) => `#${hex(r)}${hex(g)}${hex(b)}`)),
);
const BACKGROUNDS: readonly Background[] = ["neutral", "tinted"];

const failingRules = (theme: DerivedTheme, mode: Mode) =>
  checkRules(
    THEME_RULES[mode],
    (token) => (theme[mode][token] ?? WAITRON_DEFAULTS[mode][token])!,
  ).filter((result) => !result.pass);

interface SweepCase {
  readonly picked: DerivedTheme;
  readonly fixed: DerivedTheme;
  readonly failing: Record<Mode, ReturnType<typeof failingRules>>;
}

const swept = new Map<string, SweepCase>();

/** Each brand and background is derived once, whichever test asks first. */
function sweep(brandColor: string, background: Background): SweepCase {
  const key = `${brandColor} ${background}`;
  const known = swept.get(key);
  if (known) return known;
  const choices = { ...WAITRON_CHOICES, brandColor, background };
  const picked = deriveTheme(choices);
  const failing = { light: failingRules(picked, "light"), dark: failingRules(picked, "dark") };
  const brandFix: Partial<Record<Mode, true>> = {};
  for (const mode of MODES) if (failing[mode].length > 0) brandFix[mode] = true;
  const result = { picked, fixed: deriveTheme({ ...choices, brandFix }), failing };
  swept.set(key, result);
  return result;
}

const unexplainedIn = (failing: ReturnType<typeof failingRules>) =>
  failing.filter(({ rule }) => rule.a !== PRIMARY && rule.b !== PRIMARY);

for (const brandColor of BRANDS) {
  for (const background of BACKGROUNDS) {
    test(`${brandColor} on ${background}: every failing rule names the brand colour, and its fix clears it`, () => {
      const { picked, fixed, failing: failingByMode } = sweep(brandColor, background);
      for (const mode of MODES) {
        const failing = failingByMode[mode];
        expect(unexplainedIn(failing), mode).toEqual([]);
        const warnings = picked.warnings.filter((warning) => warning.mode === mode);
        if (failing.length === 0) {
          expect(warnings, mode).toEqual([]);
        } else {
          expect(warnings, mode).toHaveLength(1);
          expect(warnings[0]!.field).toBe("brandColor");
          expect(warnings[0]!.fix, mode).not.toBeNull();
        }
        if (background === "tinted") expect(picked.tintStrength?.[mode], mode).toBe(1);
      }

      expect(fixed.warnings).toEqual([]);
      for (const mode of MODES) {
        expect(failingRules(fixed, mode), mode).toEqual([]);
        const offered = picked.warnings.find((warning) => warning.mode === mode);
        if (offered) expect(fixed[mode][PRIMARY], mode).toBe(offered.fix);
        if (background === "tinted") expect(fixed.tintStrength?.[mode], mode).toBe(1);
        expect(Object.keys(fixed[mode])).toEqual(THEME_TOKENS);
      }
    });
  }
}

test("the sweep's totals match the reference's", () => {
  const totals = {
    cases: 0,
    warnings: 0,
    warnedLight: new Set<string>(),
    warnedDark: new Set<string>(),
    noFix: 0,
    failingAfterFix: 0,
    unexplained: 0,
    tintWeakened: 0,
  };
  for (const brandColor of BRANDS) {
    for (const background of BACKGROUNDS) {
      const { picked, fixed, failing } = sweep(brandColor, background);
      for (const mode of MODES) {
        totals.cases++;
        if (unexplainedIn(failing[mode]).length > 0) totals.unexplained++;
        if (failing[mode].length > 0) {
          totals.warnings++;
          (mode === "light" ? totals.warnedLight : totals.warnedDark).add(brandColor);
          const warning = picked.warnings.find((candidate) => candidate.mode === mode);
          if (warning?.fix === null) totals.noFix++;
        }
        if (failingRules(fixed, mode).length > 0) totals.failingAfterFix++;
        if (background === "tinted") {
          if (picked.tintStrength?.[mode] !== 1) totals.tintWeakened++;
          if (fixed.tintStrength?.[mode] !== 1) totals.tintWeakened++;
        }
      }
    }
  }
  expect({
    ...totals,
    warnedLight: totals.warnedLight.size,
    warnedDark: totals.warnedDark.size,
  }).toEqual({
    cases: 864,
    warnings: 363,
    warnedLight: 112,
    warnedDark: 73,
    noFix: 0,
    failingAfterFix: 0,
    unexplained: 0,
    tintWeakened: 0,
  });
});
