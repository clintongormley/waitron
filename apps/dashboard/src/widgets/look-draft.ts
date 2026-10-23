import {
  MODES,
  THEME_COLOURS,
  WAITRON_CHOICES,
  type Background,
  type Corners,
  type Mode,
  type ThemeChoices,
  type ThemeColour,
} from "@waitron/ui-core/theme";

export type HandField = `handSet.${Mode}.${ThemeColour}`;

export type HandCodes = Readonly<Record<Mode, Readonly<Partial<Record<ThemeColour, string>>>>>;

/**
 * `choices` only ever holds a valid colour; `code` and `handCodes` are the code fields' text as
 * typed.
 */
export interface LookDraft {
  readonly choices: ThemeChoices;
  readonly code: string;
  readonly handCodes: HandCodes;
}

const NO_HAND_CODES: HandCodes = { light: {}, dark: {} };

const CODE = /^#[0-9a-f]{6}$/i;

const codeKey = (code: string) => code.trim().toLowerCase();

export function openDraft(choices: ThemeChoices | null): LookDraft {
  const opened = choices ?? WAITRON_CHOICES;
  return { choices: opened, code: opened.brandColor ?? "", handCodes: NO_HAND_CODES };
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

export function sameDraft(a: LookDraft, b: LookDraft): boolean {
  const x = a.choices;
  const y = b.choices;
  return (
    x.brandColor === y.brandColor &&
    x.background === y.background &&
    x.corners === y.corners &&
    MODES.every(
      (mode) =>
        Boolean(x.brandFix[mode]) === Boolean(y.brandFix[mode]) &&
        sameHand(x.handSet[mode], y.handSet[mode]) &&
        THEME_COLOURS.every((key) => invalidHand(a, mode, key) === invalidHand(b, mode, key)),
    ) &&
    codeKey(a.code) === codeKey(b.code)
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
    choices: { ...draft.choices, handSet: { light: {}, dark: {} } },
    handCodes: NO_HAND_CODES,
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
  return MODES.some((mode) => THEME_COLOURS.some((key) => handTouched(draft, mode, key)));
}

export function waitronLook(): LookDraft {
  return { choices: WAITRON_CHOICES, code: "", handCodes: NO_HAND_CODES };
}

export function isWaitronLook(draft: LookDraft): boolean {
  return sameDraft(draft, waitronLook());
}
