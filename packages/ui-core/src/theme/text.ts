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
