import { MODES, type Mode, type WaitronDefaults } from "./defaults.js";
import { settleMode } from "./derive.js";
import type { Corners, ThemeColour } from "./tokens.js";

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

export function normaliseChoices(choices: ThemeChoices): ThemeChoices {
  const { brandColor } = choices;
  if (brandColor === null) return { ...choices, brandFix: {} };
  if (!HEX.test(brandColor)) throw new RangeError(`not a #rrggbb colour: ${brandColor}`);
  return { ...choices, brandColor: brandColor.toLowerCase() };
}

export function deriveThemeFrom(defaults: WaitronDefaults, choices: ThemeChoices): DerivedTheme {
  const normalised = normaliseChoices(choices);
  const [light, dark] = MODES.map((mode) => settleMode(defaults, normalised, mode, {})) as [
    ReturnType<typeof settleMode>,
    ReturnType<typeof settleMode>,
  ];
  return {
    light: light.tokens,
    dark: dark.tokens,
    warnings: [],
    tintStrength:
      normalised.background === "tinted"
        ? { light: light.tintStrength, dark: dark.tintStrength }
        : null,
  };
}
