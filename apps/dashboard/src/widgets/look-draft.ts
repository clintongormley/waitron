import {
  MODES,
  THEME_COLOURS,
  WAITRON_CHOICES,
  type Background,
  type Corners,
  type Mode,
  type ThemeChoices,
  type ThemeColour,
  type ThemeLogo,
  type TextScale,
  type TextSizeKey,
  type TextWeight,
  type TextWeightKey,
  type ThemeText,
  type Typeface,
  TEXT_SIZE_KEYS,
  TEXT_WEIGHT_KEYS,
  isTextSize,
  normaliseText,
  sameText,
} from "@waitron/ui-core/theme";

export type HandField = `handSet.${Mode}.${ThemeColour}`;

export type HandCodes = Readonly<Record<Mode, Readonly<Partial<Record<ThemeColour, string>>>>>;

export type TextCodes = Readonly<Partial<Record<TextSizeKey, string>>>;

export type TextField = "text.family" | `text.size.${TextSizeKey}` | `text.weight.${TextWeightKey}`;

export const TEXT_FIELDS: readonly TextField[] = [
  "text.family",
  ...TEXT_SIZE_KEYS.map((key) => `text.size.${key}` as const),
  ...TEXT_WEIGHT_KEYS.map((key) => `text.weight.${key}` as const),
];

/**
 * `choices` only ever holds a valid colour and size; `code`, `handCodes` and `textCodes` are the
 * fields' text as typed.
 */
export interface LookDraft {
  readonly choices: ThemeChoices;
  readonly code: string;
  readonly handCodes: HandCodes;
  readonly textCodes: TextCodes;
}

const NO_HAND_CODES: HandCodes = { light: {}, dark: {} };

const CODE = /^#[0-9a-f]{6}$/i;

const codeKey = (code: string) => code.trim().toLowerCase();

export function openDraft(choices: ThemeChoices | null): LookDraft {
  const opened = choices ?? WAITRON_CHOICES;
  return {
    choices: opened,
    code: opened.brandColor ?? "",
    handCodes: NO_HAND_CODES,
    textCodes: {},
  };
}

function sameHand(
  a: Readonly<Partial<Record<string, string>>>,
  b: Readonly<Partial<Record<string, string>>>,
): boolean {
  const set = (hand: typeof a) =>
    Object.entries(hand).filter((entry): entry is [string, string] => entry[1] !== undefined);
  const x = set(a);
  const y = new Map(set(b));
  return (
    x.length === y.size &&
    x.every(([key, value]) => y.get(key)?.toLowerCase() === value.toLowerCase())
  );
}

function invalidHand(draft: LookDraft, mode: Mode, key: ThemeColour): string | undefined {
  const text = draft.handCodes[mode][key];
  if (text === undefined) return undefined;
  const typed = codeKey(text);
  return CODE.test(typed) ? undefined : typed;
}

const SIZE_TEXT = /^\d+$/;

function typedSize(text: string): number | undefined {
  const typed = text.trim();
  if (!SIZE_TEXT.test(typed)) return undefined;
  const px = Number(typed);
  return isTextSize(px) ? px : undefined;
}

function invalidSize(draft: LookDraft, key: TextSizeKey): string | undefined {
  const text = draft.textCodes[key];
  if (text === undefined) return undefined;
  return typedSize(text) === undefined ? text.trim() : undefined;
}

function sameLogo(a: ThemeLogo | null, b: ThemeLogo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.light === b.light && a.dark === b.dark;
}

export function sameDraft(a: LookDraft, b: LookDraft): boolean {
  const x = a.choices;
  const y = b.choices;
  return (
    x.brandColor === y.brandColor &&
    x.background === y.background &&
    x.corners === y.corners &&
    x.textScale === y.textScale &&
    sameText(x.text, y.text) &&
    MODES.every(
      (mode) =>
        Boolean(x.brandFix[mode]) === Boolean(y.brandFix[mode]) &&
        sameHand(x.handSet[mode], y.handSet[mode]) &&
        THEME_COLOURS.every((key) => invalidHand(a, mode, key) === invalidHand(b, mode, key)),
    ) &&
    TEXT_SIZE_KEYS.every((key) => invalidSize(a, key) === invalidSize(b, key)) &&
    codeKey(a.code) === codeKey(b.code) &&
    sameLogo(x.logo, y.logo)
  );
}

/**
 * A fix belongs to its colour: going back to the opened colour takes back the opened fix, except
 * in a mode whose Main buttons are set by hand, where no fix applies.
 */
function withBrand(draft: LookDraft, colour: string | null, opened?: LookDraft): ThemeChoices {
  if (colour === draft.choices.brandColor) return draft.choices;
  const brandFix =
    opened !== undefined && colour !== null && colour === opened.choices.brandColor
      ? Object.fromEntries(
          MODES.filter(
            (mode) =>
              opened.choices.brandFix[mode] && draft.choices.handSet[mode].primary === undefined,
          ).map((mode) => [mode, true as const]),
        )
      : {};
  return { ...draft.choices, brandColor: colour, brandFix };
}

export function pickBrand(draft: LookDraft, colour: string | null, opened?: LookDraft): LookDraft {
  return { ...draft, choices: withBrand(draft, colour, opened), code: colour ?? "" };
}

export function typeCode(draft: LookDraft, text: string, opened?: LookDraft): LookDraft {
  const key = codeKey(text);
  return {
    ...draft,
    choices: CODE.test(key) ? withBrand(draft, key, opened) : draft.choices,
    code: text,
  };
}

export function codeInvalid(draft: LookDraft): boolean {
  const key = codeKey(draft.code);
  return key === "" ? draft.choices.brandColor !== null : !CODE.test(key);
}

export function setBackground(d: LookDraft, b: Background): LookDraft {
  return { ...d, choices: { ...d.choices, background: b } };
}

export function setCorners(d: LookDraft, c: Corners): LookDraft {
  return { ...d, choices: { ...d.choices, corners: c } };
}

export function setTextScale(d: LookDraft, textScale: TextScale): LookDraft {
  return { ...d, choices: { ...d.choices, textScale } };
}

function withoutKey<K extends string, V>(
  record: Readonly<Partial<Record<K, V>>>,
  key: K,
): Partial<Record<K, V>> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as Partial<
    Record<K, V>
  >;
}

function withHandColour(
  choices: ThemeChoices,
  mode: Mode,
  key: ThemeColour,
  colour: string,
): ThemeChoices {
  return {
    ...choices,
    brandFix: key === "primary" ? withoutKey(choices.brandFix, mode) : choices.brandFix,
    handSet: { ...choices.handSet, [mode]: { ...choices.handSet[mode], [key]: colour } },
  };
}

export function setHand(draft: LookDraft, mode: Mode, key: ThemeColour, colour: string): LookDraft {
  return {
    ...draft,
    choices: withHandColour(draft.choices, mode, key, codeKey(colour)),
    handCodes: { ...draft.handCodes, [mode]: withoutKey(draft.handCodes[mode], key) },
  };
}

export function typeHandCode(
  draft: LookDraft,
  mode: Mode,
  key: ThemeColour,
  text: string,
): LookDraft {
  const typed = codeKey(text);
  return {
    ...draft,
    choices: CODE.test(typed) ? withHandColour(draft.choices, mode, key, typed) : draft.choices,
    handCodes: { ...draft.handCodes, [mode]: { ...draft.handCodes[mode], [key]: text } },
  };
}

/** Taking back Main buttons set by hand does not take back the brand fix that setting dropped. */
export function useWorkedOut(draft: LookDraft, mode: Mode, key: ThemeColour): LookDraft {
  return {
    ...draft,
    choices: {
      ...draft.choices,
      handSet: { ...draft.choices.handSet, [mode]: withoutKey(draft.choices.handSet[mode], key) },
    },
    handCodes: { ...draft.handCodes, [mode]: withoutKey(draft.handCodes[mode], key) },
  };
}

export function resetAllHand(draft: LookDraft): LookDraft {
  return {
    ...draft,
    choices: { ...draft.choices, handSet: { light: {}, dark: {} }, text: {} },
    handCodes: NO_HAND_CODES,
    textCodes: {},
  };
}

export function invalidHandCodes(draft: LookDraft): readonly HandField[] {
  return MODES.flatMap((mode) =>
    THEME_COLOURS.filter((key) => invalidHand(draft, mode, key) !== undefined).map(
      (key): HandField => `handSet.${mode}.${key}`,
    ),
  );
}

export function handTouched(draft: LookDraft, mode: Mode, key: ThemeColour): boolean {
  return draft.choices.handSet[mode][key] !== undefined || draft.handCodes[mode][key] !== undefined;
}

export function anyHandSet(draft: LookDraft): boolean {
  return (
    MODES.some((mode) => THEME_COLOURS.some((key) => handTouched(draft, mode, key))) ||
    anyTextSet(draft)
  );
}

function withText(draft: LookDraft, text: ThemeText): ThemeChoices {
  return { ...draft.choices, text: normaliseText(text) };
}

export function setTypeface(draft: LookDraft, family: Typeface): LookDraft {
  return { ...draft, choices: withText(draft, { ...draft.choices.text, family }) };
}

export function setWeight(draft: LookDraft, key: TextWeightKey, weight: TextWeight): LookDraft {
  const text = draft.choices.text;
  return {
    ...draft,
    choices: withText(draft, { ...text, weight: { ...text.weight, [key]: weight } }),
  };
}

function withSize(draft: LookDraft, key: TextSizeKey, px: number): ThemeChoices {
  const text = draft.choices.text;
  return withText(draft, { ...text, size: { ...text.size, [key]: px } });
}

export function setTextSize(draft: LookDraft, key: TextSizeKey, px: number): LookDraft {
  return {
    ...draft,
    choices: withSize(draft, key, px),
    textCodes: withoutKey(draft.textCodes, key),
  };
}

export function typeTextSize(draft: LookDraft, key: TextSizeKey, text: string): LookDraft {
  const px = typedSize(text);
  return {
    ...draft,
    choices: px === undefined ? draft.choices : withSize(draft, key, px),
    textCodes: { ...draft.textCodes, [key]: text },
  };
}

type FieldParts =
  | { readonly part: "family" }
  | { readonly part: "size"; readonly key: TextSizeKey }
  | { readonly part: "weight"; readonly key: TextWeightKey };

function partsOf(field: TextField): FieldParts {
  const [, part, key] = field.split(".");
  if (part === "size") return { part, key: key as TextSizeKey };
  if (part === "weight") return { part, key: key as TextWeightKey };
  return { part: "family" };
}

export function useWorkedOutText(draft: LookDraft, field: TextField): LookDraft {
  const parts = partsOf(field);
  const text = draft.choices.text;
  switch (parts.part) {
    case "family":
      return { ...draft, choices: withText(draft, { ...text, family: undefined }) };
    case "size":
      return {
        ...draft,
        choices: withText(draft, { ...text, size: withoutKey(text.size ?? {}, parts.key) }),
        textCodes: withoutKey(draft.textCodes, parts.key),
      };
    case "weight":
      return {
        ...draft,
        choices: withText(draft, { ...text, weight: withoutKey(text.weight ?? {}, parts.key) }),
      };
  }
}

export function invalidTextCodes(draft: LookDraft): readonly TextField[] {
  return TEXT_SIZE_KEYS.filter((key) => invalidSize(draft, key) !== undefined).map(
    (key): TextField => `text.size.${key}`,
  );
}

export function textTouched(draft: LookDraft, field: TextField): boolean {
  const parts = partsOf(field);
  const text = draft.choices.text;
  switch (parts.part) {
    case "family":
      return text.family !== undefined;
    case "size":
      return text.size?.[parts.key] !== undefined || draft.textCodes[parts.key] !== undefined;
    case "weight":
      return text.weight?.[parts.key] !== undefined;
  }
}

export function anyTextSet(draft: LookDraft): boolean {
  return TEXT_FIELDS.some((field) => textTouched(draft, field));
}

export function waitronLook(): LookDraft {
  return { choices: WAITRON_CHOICES, code: "", handCodes: NO_HAND_CODES, textCodes: {} };
}

export function isWaitronLook(draft: LookDraft): boolean {
  return sameDraft(draft, waitronLook());
}

export function withLightLogo(logo: ThemeLogo | null, name: string | null): ThemeLogo | null {
  if (name === null) return null;
  return logo?.dark === undefined ? { light: name } : { light: name, dark: logo.dark };
}

/** A dark logo stands only beside a light one. */
export function withDarkLogo(logo: ThemeLogo | null, name: string | null): ThemeLogo | null {
  if (logo === null) return null;
  return name === null ? { light: logo.light } : { light: logo.light, dark: name };
}

export function setLogo(draft: LookDraft, logo: ThemeLogo | null): LookDraft {
  return { ...draft, choices: { ...draft.choices, logo } };
}
