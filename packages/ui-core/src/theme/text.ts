import type { WaitronDefaults } from "./defaults.js";
import { fontSizes, type TextScale } from "./tokens.js";

export const TYPEFACES = ["system", "serif"] as const;

export type Typeface = (typeof TYPEFACES)[number];

export const TEXT_SIZE_KEYS = ["sm", "md", "lg", "xl"] as const;

export type TextSizeKey = (typeof TEXT_SIZE_KEYS)[number];

export const TEXT_WEIGHT_KEYS = ["normal", "medium", "bold"] as const;

export type TextWeightKey = (typeof TEXT_WEIGHT_KEYS)[number];

export const TEXT_WEIGHTS = [400, 500, 600, 700, 800] as const;

export type TextWeight = (typeof TEXT_WEIGHTS)[number];

export const TEXT_SIZE_MIN = 8;

export const TEXT_SIZE_MAX = 40;

/** Only what is set by hand; an absent part follows Waitron's own. */
export interface ThemeText {
  readonly family?: Typeface;
  readonly size?: Readonly<Partial<Record<TextSizeKey, number>>>;
  readonly weight?: Readonly<Partial<Record<TextWeightKey, TextWeight>>>;
}

export const isTextSize = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= TEXT_SIZE_MIN &&
  (value as number) <= TEXT_SIZE_MAX;

function inOrder<K extends string, V>(
  keys: readonly K[],
  values: Readonly<Partial<Record<K, V>>> | undefined,
): Partial<Record<K, V>> | undefined {
  if (values === undefined) return undefined;
  const entries = keys.flatMap((key) => (values[key] === undefined ? [] : [[key, values[key]]]));
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as Partial<Record<K, V>>);
}

/** Drops empty parts and writes the keys in list order. */
export function normaliseText(text: ThemeText): ThemeText {
  const size = inOrder(TEXT_SIZE_KEYS, text.size);
  const weight = inOrder(TEXT_WEIGHT_KEYS, text.weight);
  return {
    ...(text.family === undefined ? {} : { family: text.family }),
    ...(size === undefined ? {} : { size }),
    ...(weight === undefined ? {} : { weight }),
  };
}

export function sameText(a: ThemeText, b: ThemeText): boolean {
  return JSON.stringify(normaliseText(a)) === JSON.stringify(normaliseText(b));
}

/** The one place a typeface choice becomes a CSS font stack. */
export function typefaceStack(family: Typeface, defaults: WaitronDefaults): string {
  switch (family) {
    case "system":
      return defaults.structure["--wt-font-family"]!;
    case "serif":
      return 'ui-serif, Georgia, "Times New Roman", serif';
    default: {
      const unknown: never = family;
      throw new RangeError(`not a typeface: ${String(unknown)}`);
    }
  }
}

/** A size at 100% times `textScale`, rounded half up to whole pixels. */
export const drawnSize = (px: number, textScale: TextScale): number =>
  Math.floor((px * textScale + 50) / 100);

const WHOLE_HUNDRED = /^[1-9]00$/;

/** The four sizes, the typeface and the three weights, keyed by full token name. */
export function textTokens(
  textScale: TextScale,
  text: ThemeText,
  defaults: WaitronDefaults,
): Record<string, string> {
  const weights = TEXT_WEIGHT_KEYS.map((key) => {
    const name = `--wt-font-weight-${key}`;
    const fallback = defaults.structure[name] ?? "";
    if (!WHOLE_HUNDRED.test(fallback)) throw new RangeError(`not a whole-hundred weight: ${name}`);
    return [name, String(text.weight?.[key] ?? fallback)];
  });
  return {
    ...fontSizes(textScale, defaults, text.size),
    "--wt-font-family": typefaceStack(text.family ?? "system", defaults),
    ...Object.fromEntries(weights),
  };
}
