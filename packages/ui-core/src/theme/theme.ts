import { MODES, type Mode, type WaitronDefaults } from "./defaults.js";
import { type ModeResult, handTokens, settleMode } from "./derive.js";
import { warningsFor } from "./warnings.js";
import { type Corners, type ThemeColour, THEME_COLOURS, colourToken } from "./tokens.js";

const PRIMARY = colourToken("primary");

export type Background = "neutral" | "tinted";

export interface ThemeChoices {
  /** `null` is Waitron's own brand colour. */
  readonly brandColor: string | null;
  readonly brandFix: Readonly<Partial<Record<Mode, true>>>;
  readonly background: Background;
  readonly corners: Corners;
  readonly handSet: Readonly<Record<Mode, Readonly<Partial<Record<ThemeColour, string>>>>>;
}

export const WAITRON_CHOICES: ThemeChoices = {
  brandColor: null,
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};

export type WarningField = "brandColor" | `handSet.${Mode}.${ThemeColour}`;

export interface ThemeWarning {
  readonly field: WarningField;
  readonly mode: Mode;
  /** Theme keys without the `--wt-color-` prefix. */
  readonly against: readonly string[];
  readonly fix: string | null;
  /** The hand-set keys that block every shade when `fix` is null; otherwise empty. */
  readonly blockedBy: readonly string[];
}

export interface DerivedTheme {
  /** Keys exactly `THEME_TOKENS`, in that order. */
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
  readonly warnings: readonly ThemeWarning[];
  /** `null` for Neutral; otherwise 0 to 1 in tenths. */
  readonly tintStrength: Readonly<Record<Mode, number>> | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

function lowerHex(value: string): string {
  if (!HEX.test(value)) throw new RangeError(`not a #rrggbb colour: ${value}`);
  return value.toLowerCase();
}

function normaliseHand(
  values: Readonly<Partial<Record<ThemeColour, string>>>,
): Partial<Record<ThemeColour, string>> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (!(THEME_COLOURS as readonly string[]).includes(key)) {
        throw new RangeError(`not a theme colour: ${key}`);
      }
      return [key, lowerHex(value)];
    }),
  );
}

export function normaliseChoices(choices: ThemeChoices): ThemeChoices {
  const handSet = {
    light: normaliseHand(choices.handSet.light),
    dark: normaliseHand(choices.handSet.dark),
  };
  const { brandColor } = choices;
  if (brandColor === null) return { ...choices, brandFix: {}, handSet };
  const brandFix = { ...choices.brandFix };
  for (const mode of MODES) if (handSet[mode].primary !== undefined) delete brandFix[mode];
  return { ...choices, brandColor: lowerHex(brandColor), brandFix, handSet };
}

export function deriveThemeFrom(defaults: WaitronDefaults, choices: ThemeChoices): DerivedTheme {
  const normalised = normaliseChoices(choices);
  const light: ModeResult = settleMode(
    defaults,
    normalised,
    "light",
    handTokens(normalised.handSet.light),
  );
  const dark: ModeResult = settleMode(
    defaults,
    normalised,
    "dark",
    handTokens(normalised.handSet.dark),
  );
  return {
    light: light.tokens,
    dark: dark.tokens,
    warnings: [
      ...warningsFor(defaults, normalised, "light", light),
      ...warningsFor(defaults, normalised, "dark", dark),
    ],
    tintStrength:
      normalised.background === "tinted"
        ? { light: light.tintStrength, dark: dark.tintStrength }
        : null,
  };
}

/**
 * Takes fixes one at a time, per mode: of the first failing rule naming a warned colour with a fix,
 * the fix of the colour drawn on top if it has one, else of the other; then settles again.
 */
export function fixAll(defaults: WaitronDefaults, choices: ThemeChoices): ThemeChoices {
  let current = normaliseChoices(choices);
  for (const mode of MODES) {
    for (let round = 0; round < 50; round++) {
      const settled = settleMode(defaults, current, mode, handTokens(current.handSet[mode]));
      const withFix = new Map(
        warningsFor(defaults, current, mode, settled, false)
          .filter((warning) => warning.fix !== null)
          .map((warning) => [
            warning.field === "brandColor" ? PRIMARY : colourToken(warning.field.split(".")[2]!),
            warning,
          ]),
      );
      if (withFix.size === 0) break;
      let pick: ThemeWarning | undefined;
      for (const { rule } of settled.failures) {
        pick = withFix.get(rule.a) ?? withFix.get(rule.b);
        if (pick) break;
      }
      pick ??= [...withFix.values()][0]!;
      current = normaliseChoices(
        pick.field === "brandColor"
          ? { ...current, brandFix: { ...current.brandFix, [mode]: true } }
          : {
              ...current,
              handSet: {
                ...current.handSet,
                [mode]: { ...current.handSet[mode], [pick.field.split(".")[2]!]: pick.fix },
              },
            },
      );
    }
  }
  return current;
}

/** Whether Fix and save is offered: Fix all leaves no warning. */
export function canFixAll(defaults: WaitronDefaults, choices: ThemeChoices): boolean {
  return deriveThemeFrom(defaults, fixAll(defaults, choices)).warnings.length === 0;
}
