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
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => b[key] !== undefined && a[key]!.toLowerCase() === b[key]!.toLowerCase())
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

function withBrand(draft: LookDraft, colour: string | null): ThemeChoices {
  return colour === draft.choices.brandColor
    ? draft.choices
    : { ...draft.choices, brandColor: colour, brandFix: {} };
}

export function pickBrand(draft: LookDraft, colour: string | null): LookDraft {
  return { choices: withBrand(draft, colour), code: colour ?? "" };
}

export function typeCode(draft: LookDraft, text: string): LookDraft {
  const key = codeKey(text);
  return { choices: CODE.test(key) ? withBrand(draft, key) : draft.choices, code: text };
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
