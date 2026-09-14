// packages/ui/src/category-color.ts
/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const c = hex
    .replace("#", "")
    .match(/../g)!
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/**
 * Black or white, whichever contrasts more with `hex`. Never refuses: black clears 4.5:1 for
 * luminance >= 0.175, white for <= 0.183, and the ranges overlap, so every colour passes with one.
 */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const l = luminance(hex);
  const black = (l + 0.05) / 0.05;
  const white = 1.05 / (l + 0.05);
  return black >= white ? "#000000" : "#ffffff";
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/.test(value);
}

// Eight hues x three tones, generated from HSL(hue, 65%, {42,62,80}%) and pinned as literals so a
// formula change can never move a stored colour off a swatch. Hue order: red, orange, yellow,
// green, teal, blue, violet, magenta. Tone order within each hue block: dark, mid, pale.
export const CATEGORY_PALETTE = [
  "#b12525",
  "#dd5f5f",
  "#edabab",
  "#b16b25",
  "#dd9e5f",
  "#edccab",
  "#b1b125",
  "#dddd5f",
  "#ededab",
  "#25b125",
  "#5fdd5f",
  "#abedab",
  "#25b19a",
  "#5fddc8",
  "#abede2",
  "#256bb1",
  "#5f9edd",
  "#abcced",
  "#5425b1",
  "#895fdd",
  "#c1abed",
  "#b125b1",
  "#dd5fdd",
  "#edabed",
] as const;
