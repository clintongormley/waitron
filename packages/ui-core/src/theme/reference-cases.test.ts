import { describe, expect, test } from "vitest";
import cases from "./__fixtures__/reference-cases.json";
import paletteCases from "./__fixtures__/reference-palette-cases.json";
import { MODES, type WaitronDefaults } from "./defaults.js";
import {
  canFixAll,
  deriveThemeFrom,
  fixAll,
  type ThemeChoices,
  type ThemeWarning,
} from "./theme.js";
import { colourToken, THEME_COLOURS } from "./tokens.js";
import { WAITRON_DEFAULTS } from "./waitron.js";

// Inputs that tell apart code shapes the hand-written cases do not, found by searching drawn
// choices or built by hand; every expected value was computed by the reference with fix round 1's
// rulings on: ~/waitron-campaign/a841-plan1-probes/t9/pins2.mjs, run on cases-all2.tsv, output
// output-pins2b.json, equal as parsed JSON to this fixture. A `label` of the form file:line:col is
// where the search found the input, in the source before Task 9; the others describe a built case.

interface ReferenceCase {
  readonly label: string;
  /** Waitron's values this case replaces: a made-up palette. */
  readonly overrides?: Partial<Record<"light" | "dark", Record<string, string>>>;
  readonly choices: ThemeChoices;
  readonly colours: Record<"light" | "dark", Record<string, string>>;
  readonly warnings: readonly ThemeWarning[];
  readonly tint: Record<"light" | "dark", number> | null;
  readonly fixAll?: ThemeChoices;
  readonly canFixAll?: boolean;
}

// Made-up palettes (Waitron's values with one to three replaced) reach rules no input drawn on
// Waitron's real palette failed, such as one between worked-out colours after a fix's settling.
// Fifteen were found by csearch.mjs, labelled file:line:col in the source after Task 9's first
// round; the last is the reviewer's example, built by hand. Values from pins3.mjs run on cases3.tsv,
// output output-pins3.json, equal as parsed JSON to the second fixture.
function holds(reference: ReferenceCase) {
  const defaults: WaitronDefaults = {
    ...WAITRON_DEFAULTS,
    light: { ...WAITRON_DEFAULTS.light, ...reference.overrides?.light },
    dark: { ...WAITRON_DEFAULTS.dark, ...reference.overrides?.dark },
  };
  const theme = deriveThemeFrom(defaults, reference.choices);
  for (const mode of MODES) {
    for (const colour of THEME_COLOURS) {
      expect(theme[mode][colourToken(colour)], `${mode} ${colour}`).toBe(
        reference.colours[mode][colour],
      );
    }
  }
  expect(theme.warnings).toStrictEqual(reference.warnings);
  expect(theme.tintStrength).toStrictEqual(reference.tint);
  if (reference.fixAll !== undefined) {
    expect(fixAll(defaults, reference.choices)).toStrictEqual(reference.fixAll);
    expect(canFixAll(defaults, reference.choices)).toBe(reference.canFixAll);
  }
}

for (const [name, table] of [
  ["cases computed by the reference", cases],
  ["made-up palettes computed by the reference", paletteCases],
] as const) {
  describe(name, () => {
    for (const reference of table as unknown as ReferenceCase[]) {
      test(`${reference.label}: ${JSON.stringify(reference.overrides ?? {})} ${JSON.stringify(reference.choices)}`, () =>
        holds(reference));
    }
  });
}
