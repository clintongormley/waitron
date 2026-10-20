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

const totals = {
  cases: 0,
  warnings: 0,
  noFix: 0,
  failingAfterFix: 0,
  unexplained: 0,
  tintWeakened: 0,
  warnedBrands: { light: new Set<string>(), dark: new Set<string>() },
};

for (const brandColor of BRANDS) {
  for (const background of BACKGROUNDS) {
    test(`${brandColor} on ${background}: every failing rule names the brand colour, and its fix clears it`, () => {
      const choices = { ...WAITRON_CHOICES, brandColor, background };
      const picked = deriveTheme(choices);
      const brandFix: Partial<Record<Mode, true>> = {};
      for (const mode of MODES) {
        totals.cases++;
        const failing = failingRules(picked, mode);
        const unexplained = failing.filter(({ rule }) => rule.a !== PRIMARY && rule.b !== PRIMARY);
        if (unexplained.length > 0) totals.unexplained++;
        expect(unexplained, mode).toEqual([]);
        const warnings = picked.warnings.filter((warning) => warning.mode === mode);
        if (failing.length === 0) {
          expect(warnings, mode).toEqual([]);
        } else {
          totals.warnings++;
          totals.warnedBrands[mode].add(brandColor);
          expect(warnings, mode).toHaveLength(1);
          expect(warnings[0]!.field).toBe("brandColor");
          if (warnings[0]!.fix === null) totals.noFix++;
          expect(warnings[0]!.fix, mode).not.toBeNull();
          brandFix[mode] = true;
        }
        if (background === "tinted") {
          if (picked.tintStrength?.[mode] !== 1) totals.tintWeakened++;
          expect(picked.tintStrength?.[mode], mode).toBe(1);
        }
      }

      const fixed = deriveTheme({ ...choices, brandFix });
      expect(fixed.warnings).toEqual([]);
      for (const mode of MODES) {
        const failing = failingRules(fixed, mode);
        if (failing.length > 0) totals.failingAfterFix++;
        expect(failing, mode).toEqual([]);
        const offered = picked.warnings.find((warning) => warning.mode === mode);
        if (offered) expect(fixed[mode][PRIMARY], mode).toBe(offered.fix);
        if (background === "tinted") {
          if (fixed.tintStrength?.[mode] !== 1) totals.tintWeakened++;
          expect(fixed.tintStrength?.[mode], mode).toBe(1);
        }
        expect(Object.keys(fixed[mode])).toEqual(THEME_TOKENS);
      }
    });
  }
}

test("the sweep's totals match the reference's", () => {
  expect({
    cases: totals.cases,
    warnings: totals.warnings,
    warnedLight: totals.warnedBrands.light.size,
    warnedDark: totals.warnedBrands.dark.size,
    noFix: totals.noFix,
    failingAfterFix: totals.failingAfterFix,
    unexplained: totals.unexplained,
    tintWeakened: totals.tintWeakened,
  }).toEqual({
    cases: 864,
    warnings: 360,
    warnedLight: 111,
    warnedDark: 73,
    noFix: 0,
    failingAfterFix: 0,
    unexplained: 0,
    tintWeakened: 0,
  });
});
