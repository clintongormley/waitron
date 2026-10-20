import { contrastRatio, fromOklch, luminanceRatio, relativeLuminance, toOklch } from "./colour.js";
import {
  type ContrastRule,
  type RuleResult,
  STATIONS,
  THEME_RULES,
  passes,
} from "./contrast-rules.js";
import type { Mode, WaitronDefaults } from "./defaults.js";
import type { ThemeChoices } from "./theme.js";
import { type ThemeColour, THEME_COLOUR_TOKENS, colourToken, cornerRadii } from "./tokens.js";

export const PRIMARY = colourToken("primary");

/**
 * Answers that repeat within one call, each a pure function of its key under that call's
 * defaults. Nothing empties it, so it lives for one call only.
 */
export interface Memo {
  readonly settles: Map<string, ModeResult>;
  readonly walks: Map<string, string>;
  readonly hovers: Map<string, string>;
  readonly pushes: Map<string, string>;
  readonly shades: Map<string, readonly string[]>;
  readonly luminances: Map<string, number>;
}

export const newMemo = (): Memo => ({
  settles: new Map(),
  walks: new Map(),
  hovers: new Map(),
  pushes: new Map(),
  shades: new Map(),
  luminances: new Map(),
});

export function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let found = cache.get(key);
  if (found === undefined) {
    found = make();
    cache.set(key, found);
  }
  return found;
}

/** The results `checkRules` gives for `rules` that fail. */
export function failingIn(
  memo: Memo,
  rules: readonly ContrastRule[],
  colourOf: (token: string) => string,
): RuleResult[] {
  const luminance = (token: string) => {
    const hex = colourOf(token);
    return remember(memo.luminances, hex, () => relativeLuminance(hex));
  };
  const failed: RuleResult[] = [];
  for (const rule of rules) {
    const ratio = luminanceRatio(luminance(rule.a), luminance(rule.b));
    const pass = passes(rule, ratio);
    if (!pass) failed.push({ rule, ratio, pass });
  }
  return failed;
}

const STATION_FILLS = STATIONS.map(colourToken);

/** The tinted colours of each mode and the OKLCH lightness and chroma each is tinted toward. */
const TINT_TARGETS: Readonly<
  Record<Mode, Partial<Record<ThemeColour, readonly [number, number]>>>
> = {
  light: {
    bg: [0.974, 0.012],
    "surface-sunken": [0.885, 0.014],
    border: [0.885, 0.014],
    track: [0.845, 0.014],
    "field-fill": [0.955, 0.01],
    "field-fill-disabled": [0.975, 0.006],
  },
  dark: {
    bg: [0.17, 0.012],
    surface: [0.215, 0.014],
    "surface-raised": [0.255, 0.016],
    "surface-sunken": [0.17, 0.012],
    border: [0.33, 0.016],
    track: [0.33, 0.016],
    "field-fill": [0.27, 0.016],
    "field-fill-disabled": [0.235, 0.012],
  },
};

/** The grounds the button colour sits on. */
const BRAND_GROUNDS = ["bg", "surface", "surface-raised", "field-fill"].map(colourToken);
/** The brand fix also clears the number stepper's fill, on which the stepper paints its icon in the button colour. */
const BRAND_FIX_GROUNDS = [...BRAND_GROUNDS, colourToken("stepper-button")];

/**
 * One step of a lightness walk; `null` once the lightness is pinned at 0 or 1, since every later
 * step would repeat this colour. The reference also takes a first step that repeats; only #000000
 * starts pinned, and it maps to itself (checked over all 16.7M #rrggbb colours; receipt in the
 * slice 1 PR).
 */
function stepped(L: number, dir: number, size: number): number | null {
  if (dir === 1 ? !(L < 1) : !(L > 0)) return null;
  return Math.min(1, Math.max(0, L + dir * size));
}

/** Steps `from`'s lightness until `done` holds, the lightness is pinned, or `steps` run out. */
function walk(
  from: string,
  dir: number,
  size: number,
  steps: number,
  done: (colour: string) => boolean,
): string {
  const start = toOklch(from);
  let L = start.L;
  let out = from;
  for (let i = 0; i < steps && !done(out); i++) {
    const next = stepped(L, dir, size);
    if (next === null) break;
    L = next;
    out = fromOklch({ ...start, L });
  }
  return out;
}

/**
 * Walks `hex`'s lightness in 0.005 steps until it has `need` against every colour in `list`. The
 * reference stops after 200 steps; no #rrggbb walk takes more before its lightness is pinned
 * (checked over all 16.7M #rrggbb colours; receipt in the slice 1 PR), so this one needs no count.
 */
function until(
  memo: Memo,
  hex: string,
  dir: number,
  list: readonly string[],
  need: number,
): string {
  return remember(memo.walks, JSON.stringify([hex, dir, need, list]), () => {
    const grounds = list.map(relativeLuminance);
    return walk(hex, dir, 0.005, Infinity, (colour) => {
      const own = relativeLuminance(colour);
      return Math.min(...grounds.map((ground) => luminanceRatio(own, ground))) >= need;
    });
  });
}

/** The first lightness away from `on`, else toward it, in 0.02 steps that shows and keeps `on` readable. */
function hoverOf(memo: Memo, primary: string, on: string): string {
  return remember(memo.hovers, JSON.stringify([primary, on]), () => {
    const start = toOklch(primary);
    const away = relativeLuminance(on) > relativeLuminance(primary) ? -1 : +1;
    let hover = primary;
    search: for (const dir of [away, -away]) {
      for (let step = 1; step < 50; step++) {
        hover = fromOklch({ ...start, L: start.L + dir * 0.02 * step });
        if (contrastRatio(hover, primary) >= 1.2 && contrastRatio(hover, on) >= 4.5) {
          break search;
        }
      }
    }
    return hover;
  });
}

function brandFixShade(memo: Memo, brand: string, mode: Mode, grounds: readonly string[]): string {
  return until(memo, brand, mode === "dark" ? +1 : -1, grounds, 3);
}

function deriveAt(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  tintStrength: number,
  fixed: Readonly<Record<string, string>>,
): Record<string, string> {
  const d = defaults[mode];
  const chosen = choices.brandColor;
  const brand = fixed[PRIMARY] ?? chosen ?? d[PRIMARY]!;
  const dark = mode === "dark";
  const { H, C: C0 } = toOklch(brand);
  const out: Record<string, string> = {};
  const get = (token: string) => (out[token] ?? d[token])!;
  const blend = (def: string, L: number, C: number) => {
    const from = toOklch(def);
    return fromOklch({
      L: from.L + (L - from.L) * tintStrength,
      C: from.C + (Math.min(C, C0) - from.C) * tintStrength,
      H,
    });
  };
  if (choices.background === "tinted" && tintStrength > 0) {
    for (const [key, [L, C]] of Object.entries(TINT_TARGETS[mode]) as [
      ThemeColour,
      readonly [number, number],
    ][]) {
      out[colourToken(key)] = blend(d[colourToken(key)]!, L, C);
    }
  }
  Object.assign(out, fixed);
  if (chosen === null && !(PRIMARY in fixed)) return out;

  out[colourToken("surface-lifted")] = fromOklch({
    L: dark ? 0.34 : 0.935,
    C: Math.min(C0, dark ? 0.04 : 0.035),
    H,
  });
  out[colourToken("stepper-button")] = fromOklch({
    L: dark ? 0.27 : 0.955,
    C: Math.min(C0, 0.035),
    H,
  });
  Object.assign(out, fixed);
  const grounds = BRAND_GROUNDS.map(get);
  const primary =
    fixed[PRIMARY] ??
    (choices.brandFix[mode] === true
      ? brandFixShade(memo, brand, mode, BRAND_FIX_GROUNDS.map(get))
      : brand);
  const ink = dark ? fromOklch({ L: 0.16, C: Math.min(C0, 0.04), H }) : "#ffffff";
  const onPrimary =
    fixed[colourToken("on-primary")] ??
    (contrastRatio(ink, primary) >= 4.5
      ? ink
      : contrastRatio("#000000", primary) >= contrastRatio("#ffffff", primary)
        ? "#000000"
        : "#ffffff");
  const lifted = get(colourToken("surface-lifted"));
  const primaryText = until(memo, brand, dark ? +1 : -1, [...grounds, lifted], 4.5);
  const hover = hoverOf(memo, primary, onPrimary);
  const stationFills = STATION_FILLS.map((token) => d[token]!);
  const focus = until(
    memo,
    primaryText,
    dark ? +1 : -1,
    [...grounds.slice(0, 2), lifted, ...stationFills],
    3,
  );
  Object.assign(out, {
    [PRIMARY]: primary,
    [colourToken("on-primary")]: onPrimary,
    [colourToken("primary-hover")]: hover,
    [colourToken("primary-text")]: primaryText,
    [colourToken("focus")]: focus,
    [colourToken("field-label-focus")]: primaryText,
    [colourToken("primary-disabled")]: fromOklch({
      L: dark ? 0.31 : 0.8,
      C: Math.min(C0, dark ? 0.04 : 0.09),
      H,
    }),
    [colourToken("on-primary-disabled")]: dark ? fromOklch({ L: 0.72, C: 0.03, H }) : "#ffffff",
  });
  Object.assign(out, fixed);
  return out;
}

export interface ModeResult {
  /** Every token in THEME_TOKENS, Waitron's values wherever the derivation writes nothing. */
  readonly tokens: Record<string, string>;
  /** The rules still failing on the settled colours. */
  readonly failures: readonly RuleResult[];
  readonly tintStrength: number;
}

const failing = (
  memo: Memo,
  defaults: WaitronDefaults,
  mode: Mode,
  tokens: Record<string, string>,
) => failingIn(memo, THEME_RULES[mode], (token) => (tokens[token] ?? defaults[mode][token])!);

/** The tint strengths tried, by repeated subtraction as the reference steps them: the last is 1.4e-16. */
const TINT_STRENGTHS = Array.from({ length: 10 }).reduce<number[]>(
  (list) => [...list, list[list.length - 1]! - 0.1],
  [1],
);

/** Moves `from` in lightness, away from `against` or toward it for an at-most rule, until the rule passes or 200 steps run out. */
function push(memo: Memo, rule: ContrastRule, from: string, against: string): string {
  return remember(memo.pushes, JSON.stringify([rule.kind, rule.need, from, against]), () => {
    const within = rule.kind === "at-most";
    const ground = relativeLuminance(against);
    const darker = ground > relativeLuminance(from);
    return walk(from, within === darker ? +1 : -1, within ? 0.002 : 0.005, 200, (colour) =>
      passes(rule, luminanceRatio(relativeLuminance(colour), ground)),
    );
  });
}

/** `hand` holds theme colour tokens only. */
export function settleMode(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): ModeResult {
  const key = JSON.stringify([
    mode,
    choices.brandColor,
    choices.background,
    choices.corners,
    choices.brandFix[mode] === true,
    [...THEME_COLOUR_TOKENS].map((token) => hand[token] ?? null),
  ]);
  return remember(memo.settles, key, () => settleAfresh(memo, defaults, choices, mode, hand));
}

function settleAfresh(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): ModeResult {
  const isHand = (token: string) => token in hand;
  const tinted = Object.keys(TINT_TARGETS[mode]).map(colourToken);
  const brandOwned = choices.brandColor !== null && !isHand(PRIMARY);
  const ownRule = ({ rule }: RuleResult) =>
    brandOwned && (rule.a === PRIMARY || rule.b === PRIMARY);
  const picked = (result: RuleResult) =>
    isHand(result.rule.a) || isHand(result.rule.b) || ownRule(result);
  const tintIn = (result: RuleResult) => {
    const { a, b } = result.rule;
    return (
      (tinted.includes(a) || tinted.includes(b)) && !isHand(a) && !isHand(b) && !ownRule(result)
    );
  };
  let strength = 1;
  if (choices.background === "tinted") {
    const found = TINT_STRENGTHS.find(
      (trial) =>
        !failing(memo, defaults, mode, deriveAt(memo, defaults, choices, mode, trial, hand)).some(
          tintIn,
        ),
    );
    strength = Math.round((found ?? 0) * 10) / 10;
  }
  const colourIn = (tokens: Record<string, string>, token: string) =>
    (tokens[token] ?? defaults[mode][token])!;
  const settled = (fixed: Readonly<Record<string, string>>) => {
    const written = deriveAt(memo, defaults, choices, mode, strength, fixed);
    return { written, fails: failing(memo, defaults, mode, written) };
  };
  const work: Record<string, string> = {};
  let current = settled({ ...hand });
  for (let round = 0; ; round++) {
    const { written, fails } = current;
    const failingNow = new Set(fails.map(({ rule }) => rule));
    // A move never newly fails a rule naming no colour the owner picked.
    const tried = (token: string, value: string) => {
      const next = settled({ ...work, [token]: value, ...hand });
      return next.fails.length < fails.length &&
        next.fails.every((result) => picked(result) || failingNow.has(result.rule))
        ? next
        : null;
    };
    let next: ReturnType<typeof settled> | null = null;
    for (const result of fails) {
      if (ownRule(result)) continue;
      const { rule } = result;
      for (const [token, other] of [
        [rule.a, rule.b],
        [rule.b, rule.a],
      ] as const) {
        if (!THEME_COLOUR_TOKENS.has(token) || isHand(token) || token === PRIMARY) continue;
        const against = colourIn(written, other);
        const value = push(memo, rule, colourIn(written, token), against);
        next = passes(rule, contrastRatio(value, against)) ? tried(token, value) : null;
        if (next !== null) {
          work[token] = value;
          break;
        }
      }
      if (next !== null) break;
    }
    // The 60th round's move is not settled.
    if (next === null || round === 59) break;
    current = next;
  }
  const { written, fails } = current;
  const tokens: Record<string, string> = {};
  for (const token of THEME_COLOUR_TOKENS) tokens[token] = colourIn(written, token);
  Object.assign(tokens, cornerRadii(choices.corners, defaults));
  return { tokens, failures: fails, tintStrength: strength };
}
