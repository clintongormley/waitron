import { MODES, type Mode } from "./defaults.js";
import { BACKGROUNDS, normaliseChoices, type ThemeChoices } from "./theme.js";
import { CORNER_CHOICES, THEME_COLOURS } from "./tokens.js";

export const THEME_DOCUMENT_KEYS = [
  "brandColor",
  "brandFix",
  "background",
  "corners",
  "handSet",
] as const satisfies readonly (keyof ThemeChoices)[];

export type ThemeRefusalReason =
  | "not_object"
  | "unknown_key"
  | "missing"
  | "bad_value"
  | "unknown_colour"
  | "fix_without_brand"
  | "fix_with_hand_set";

export type ThemeDocumentResult =
  | { readonly ok: true; readonly choices: ThemeChoices }
  | { readonly ok: false; readonly field: string; readonly reason: ThemeRefusalReason };

type Refusal = Extract<ThemeDocumentResult, { ok: false }>;
type Fields = Readonly<Record<string, unknown>>;

const HEX = /^#[0-9a-f]{6}$/i;

const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHex = (value: unknown): boolean => typeof value === "string" && HEX.test(value);

const isOneOf = (list: readonly unknown[], value: unknown): boolean => list.includes(value);

const refuse = (field: string, reason: ThemeRefusalReason): Refusal => ({
  ok: false,
  field,
  reason,
});

/** Names the known field holding an unknown key, never the key itself: the caller typed that. */
function unknownKey(
  fields: Fields,
  allowed: readonly string[],
  holder: string,
  reason: ThemeRefusalReason = "unknown_key",
): Refusal | null {
  return Object.keys(fields).every((name) => allowed.includes(name))
    ? null
    : refuse(holder, reason);
}

function checkBrandFix(value: unknown): Refusal | null {
  if (value === undefined) return refuse("brandFix", "missing");
  if (!isObject(value)) return refuse("brandFix", "bad_value");
  const unknown = unknownKey(value, MODES, "brandFix");
  if (unknown) return unknown;
  const bad = MODES.find((mode) => value[mode] !== undefined && value[mode] !== true);
  return bad === undefined ? null : refuse(`brandFix.${bad}`, "bad_value");
}

function checkHandSet(value: unknown): Refusal | null {
  if (value === undefined) return refuse("handSet", "missing");
  if (!isObject(value)) return refuse("handSet", "bad_value");
  const unknown = unknownKey(value, MODES, "handSet");
  if (unknown) return unknown;
  const absent = MODES.find((mode) => value[mode] === undefined);
  if (absent !== undefined) return refuse(`handSet.${absent}`, "missing");
  const notObject = MODES.find((mode) => !isObject(value[mode]));
  if (notObject !== undefined) return refuse(`handSet.${notObject}`, "bad_value");
  for (const mode of MODES) {
    const colours = unknownKey(
      value[mode] as Fields,
      THEME_COLOURS,
      `handSet.${mode}`,
      "unknown_colour",
    );
    if (colours) return colours;
  }
  for (const mode of MODES) {
    const entry = Object.entries(value[mode] as Fields).find(([, hex]) => !isHex(hex));
    if (entry) return refuse(`handSet.${mode}.${entry[0]}`, "bad_value");
  }
  return null;
}

function checkFixes(input: Fields): Refusal | null {
  const brandFix = input.brandFix as Partial<Record<Mode, true>>;
  const handSet = input.handSet as Record<Mode, Fields>;
  for (const mode of MODES) {
    if (brandFix[mode] !== true) continue;
    if (input.brandColor === null) return refuse(`brandFix.${mode}`, "fix_without_brand");
    if (handSet[mode].primary !== undefined) return refuse(`brandFix.${mode}`, "fix_with_hand_set");
  }
  return null;
}

/** Checks a theme document sent or stored, answering its first refusal in a fixed order. */
export function readThemeDocument(input: unknown): ThemeDocumentResult {
  if (!isObject(input)) return refuse("theme", "not_object");
  const refusal =
    unknownKey(input, THEME_DOCUMENT_KEYS, "theme") ??
    (input.brandColor === undefined
      ? refuse("brandColor", "missing")
      : input.brandColor !== null && !isHex(input.brandColor)
        ? refuse("brandColor", "bad_value")
        : null) ??
    checkBrandFix(input.brandFix) ??
    (input.background === undefined
      ? refuse("background", "missing")
      : !isOneOf(BACKGROUNDS, input.background)
        ? refuse("background", "bad_value")
        : null) ??
    (input.corners === undefined
      ? refuse("corners", "missing")
      : !isOneOf(CORNER_CHOICES, input.corners)
        ? refuse("corners", "bad_value")
        : null) ??
    checkHandSet(input.handSet) ??
    checkFixes(input);
  if (refusal) return refusal;
  return { ok: true, choices: normaliseChoices(input as unknown as ThemeChoices) };
}
