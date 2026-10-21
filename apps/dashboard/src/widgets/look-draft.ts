import {
  MODES,
  WAITRON_CHOICES,
  type Background,
  type Corners,
  type ThemeChoices,
} from "@waitron/ui-core/theme";

/** `choices` only ever holds a valid colour; `code` is the code field's text as typed. */
export interface LookDraft {
  readonly choices: ThemeChoices;
  readonly code: string;
}

const CODE = /^#[0-9a-f]{6}$/i;

const codeKey = (code: string) => code.trim().toLowerCase();

export function openDraft(choices: ThemeChoices | null): LookDraft {
  const opened = choices ?? WAITRON_CHOICES;
  return { choices: opened, code: opened.brandColor ?? "" };
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
        sameHand(x.handSet[mode], y.handSet[mode]),
    ) &&
    codeKey(a.code) === codeKey(b.code)
  );
}

/** A fix belongs to its colour: going back to the opened colour takes back the opened fix. */
function withBrand(draft: LookDraft, colour: string | null, opened?: LookDraft): ThemeChoices {
  if (colour === draft.choices.brandColor) return draft.choices;
  const brandFix =
    opened !== undefined && colour !== null && colour === opened.choices.brandColor
      ? opened.choices.brandFix
      : {};
  return { ...draft.choices, brandColor: colour, brandFix };
}

export function pickBrand(draft: LookDraft, colour: string | null, opened?: LookDraft): LookDraft {
  return { choices: withBrand(draft, colour, opened), code: colour ?? "" };
}

export function typeCode(draft: LookDraft, text: string, opened?: LookDraft): LookDraft {
  const key = codeKey(text);
  return { choices: CODE.test(key) ? withBrand(draft, key, opened) : draft.choices, code: text };
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

export function waitronLook(): LookDraft {
  return { choices: WAITRON_CHOICES, code: "" };
}

export function isWaitronLook(draft: LookDraft): boolean {
  return sameDraft(draft, waitronLook());
}
