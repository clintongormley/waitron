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

// Inputs that tell apart code shapes the hand-written cases do not; the expected values are the
// output of the prototype named under "The reference" in
// docs/superpowers/plans/2026-10-20-a841-1-theme-derivation.md. A file:line:col label names where a
// search found the input in an earlier revision of the theme source, not a line in the current one.

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
