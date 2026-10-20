import { expect, test } from "vitest";
import { THEME_RULES, checkRules } from "./contrast-rules.js";
import { MODES, type Mode } from "./defaults.js";
import { type Background, WAITRON_CHOICES, type ThemeChoices, type ThemeWarning } from "./theme.js";
import { colourToken, THEME_COLOURS, type ThemeColour } from "./tokens.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const PRIMARY = colourToken("primary");

/** A fixed linear congruential generator, so every run draws the same cases. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const byte = (max: number) =>
    Math.round(next() * max)
      .toString(16)
      .padStart(2, "0");
  return { next, pick, byte };
}

type Draw = ReturnType<typeof generator>;

function anyColour({ next, pick, byte }: Draw): string {
  const kind = next();
  if (kind < 0.4) return `#${byte(255)}${byte(255)}${byte(255)}`;
  if (kind < 0.75) return `#${byte(255).repeat(3)}`;
  return pick([
    "#000000",
    "#ffffff",
    "#0000ff",
    "#ff0000",
    "#00ff00",
    "#555555",
    "#aaaaaa",
    "#000001",
    "#7a1f2b",
  ]);
}

function darkColour({ next, byte }: Draw): string {
  const grey = byte(60);
  return next() < 0.5 ? `#${grey.repeat(3)}` : `#${byte(50)}${byte(50)}${byte(50)}`;
}

/** Any brand colour or Waitron's, any fix flags, and up to three of the 22 colours set by hand. */
function anyChoices(draw: Draw): ThemeChoices {
  const brandColor = draw.next() < 0.15 ? null : anyColour(draw);
  const background = draw.next() < 0.5 ? "tinted" : "neutral";
  const brandFix: Partial<Record<Mode, true>> = {};
  for (const mode of MODES) if (draw.next() < 0.3) brandFix[mode] = true;
  const handSet = { light: {}, dark: {} } as Record<Mode, Partial<Record<ThemeColour, string>>>;
  for (const mode of MODES) {
    const count = Math.floor(draw.next() * 4);
    for (let i = 0; i < count; i++) handSet[mode][draw.pick(THEME_COLOURS)] = anyColour(draw);
  }
  return { ...WAITRON_CHOICES, brandColor, background, brandFix, handSet };
}

const GROUNDS_AND_LINES: readonly ThemeColour[] = [
  "field-value",
  "field-line",
  "border",
  "surface",
  "bg",
  "surface-raised",
  "field-fill",
  "track",
  "surface-sunken",
  "text-muted",
];

/** Dark brands with dark greys on grounds and lines: where a moved ground can break a meaning colour. */
function darkChoices(draw: Draw): ThemeChoices {
  const brandColor = draw.pick([
    "#000000",
    "#0a0a0a",
    "#111111",
    "#1a1a2e",
    "#200000",
    "#000020",
    "#101010",
  ]);
  const background = draw.next() < 0.5 ? "tinted" : "neutral";
  const brandFix: Partial<Record<Mode, true>> = {};
  for (const mode of MODES) if (draw.next() < 0.05) brandFix[mode] = true;
  const handSet = { light: {}, dark: {} } as Record<Mode, Partial<Record<ThemeColour, string>>>;
  for (const mode of MODES) {
    const count = Math.floor(draw.next() * 4);
    for (let i = 0; i < count; i++) handSet[mode][draw.pick(GROUNDS_AND_LINES)] = darkColour(draw);
  }
  return { ...WAITRON_CHOICES, brandColor, background, brandFix, handSet };
}

const withHandValue = (
  choices: ThemeChoices,
  mode: Mode,
  colour: ThemeColour,
  value: string,
): ThemeChoices => ({
  ...choices,
  handSet: { ...choices.handSet, [mode]: { ...choices.handSet[mode], [colour]: value } },
});

const keyOf = (warning: ThemeWarning) => warning.field.split(".")[2] as ThemeColour;

/** Every failing rule names a hand-set colour or the brand colour; every fix does what it offers. */
function holds(choices: ThemeChoices, label: string) {
  const theme = deriveTheme(choices);
  for (const mode of MODES) {
    const named = new Set(Object.keys(choices.handSet[mode]).map(colourToken));
    if (choices.brandColor !== null && !named.has(PRIMARY)) named.add(PRIMARY);
    const stray = checkRules(
      THEME_RULES[mode],
      (token) => (theme[mode][token] ?? WAITRON_DEFAULTS[mode][token])!,
    ).filter(({ pass, rule }) => !pass && !named.has(rule.a) && !named.has(rule.b));
    expect(stray, `${label} ${mode}`).toEqual([]);
  }
  for (const warning of theme.warnings) {
    if (warning.fix === null) continue;
    const where = `${label} ${warning.field}`;
    if (warning.field === "brandColor") {
      const flagged = deriveTheme({
        ...choices,
        brandFix: { ...choices.brandFix, [warning.mode]: true },
      });
      expect(flagged[warning.mode][PRIMARY], where).toBe(warning.fix);
      continue;
    }
    const alone = deriveTheme(withHandValue(choices, warning.mode, keyOf(warning), warning.fix));
    expect(
      alone.warnings.some((other) => other.field === warning.field),
      where,
    ).toBe(false);
  }
}

const BATCH = 10;

for (const [name, draw, choose, batches] of [
  ["any choices", generator(11), anyChoices, 4],
  ["dark brands with dark grounds and lines", generator(5), darkChoices, 6],
] as const) {
  for (let batch = 0; batch < batches; batch++) {
    // Drawn here, not inside the test, so a filtered run still draws the same cases.
    const cases = Array.from({ length: BATCH }, () => choose(draw));
    test(`${name}, cases ${batch * BATCH + 1} to ${(batch + 1) * BATCH}: nothing fails unexplained, and every fix does what it offers`, () => {
      cases.forEach((choices, i) => holds(choices, `case ${batch * BATCH + i + 1}`));
    });
  }
}

test("the review's traced cases leave no rule failing unexplained", () => {
  const traced: readonly [string, Background, Partial<Record<ThemeColour, string>>][] = [
    [
      "#000000",
      "neutral",
      { "field-value": "#2c2c2c", "field-line": "#000001", border: "#0d121c" },
    ],
    ["#000020", "neutral", { "field-line": "#020c2f", "field-value": "#2c102a" }],
    ["#000000", "neutral", { border: "#232a25", "field-line": "#220819" }],
    ["#000020", "tinted", { "field-line": "#160f03", surface: "#2d2d2d", "text-muted": "#353535" }],
    ["#200000", "tinted", { "text-muted": "#363636", "field-line": "#080808" }],
    ["#0a0a0a", "neutral", { "field-line": "#101010" }],
    [
      "#111111",
      "neutral",
      { "field-line": "#191919", "text-muted": "#010101", surface: "#2c2c2c" },
    ],
  ];
  for (const [brandColor, background, dark] of traced) {
    holds(
      { ...WAITRON_CHOICES, brandColor, background, handSet: { light: {}, dark } },
      `${brandColor} ${background} ${JSON.stringify(dark)}`,
    );
  }
});
