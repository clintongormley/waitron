// A port of the A841 slice-1 plan's reference, ~/waitron-campaign/a841-plan1-probes/derive-h2.mjs.
import {
  contrastRatio,
  fromOklch,
  luminanceRatio,
  relativeLuminance,
  toOklch,
  withLightness,
} from "./colour.js";
import {
  type ContrastRule,
  type RuleResult,
  THEME_RULES,
  checkRules,
  passes,
} from "./contrast-rules.js";
import type { Mode, WaitronDefaults } from "./defaults.js";
import type { ThemeChoices } from "./theme.js";
import { type ThemeColour, THEME_COLOURS, colourToken, cornerRadii } from "./tokens.js";

const PRIMARY = colourToken("primary");

const STATION_FILLS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
].map((station) => colourToken(`station-${station}`));

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

/** The grounds the button colour sits on; its fix shade is worked out against them. */
const BRAND_GROUNDS = ["bg", "surface", "surface-raised", "field-fill"].map(colourToken);

/** One step of a lightness walk; `null` once the lightness is pinned at 0 or 1 and repeats. */
function stepped(L: number, delta: number, first: boolean): number | null {
  const next = Math.min(1, Math.max(0, L + delta));
  // Every later step would repeat this colour and its ratios, so the walk's answer is already known.
  return !first && next === L ? null : next;
}

function until(hex: string, dir: number, list: readonly string[], need: number): string {
  const grounds = list.map(relativeLuminance);
  const minRatio = (colour: string) => {
    const own = relativeLuminance(colour);
    return Math.min(...grounds.map((ground) => luminanceRatio(own, ground)));
  };
  let L: number | null = toOklch(hex).L;
  let out = hex;
  for (let i = 0; i < 200 && minRatio(out) < need; i++) {
    L = stepped(L, dir * 0.005, i === 0);
    if (L === null) break;
    out = withLightness(hex, L);
  }
  return out;
}

function brandFixShade(brand: string, mode: Mode, grounds: readonly string[]): string {
  return until(brand, mode === "dark" ? +1 : -1, grounds, 3);
}

function deriveAt(
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
      H: tintStrength > 0 ? H : from.H,
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

  out[colourToken("surface-lifted")] =
    fixed[colourToken("surface-lifted")] ??
    fromOklch({
      L: dark ? 0.34 : 0.935,
      C: Math.min(C0, dark ? 0.04 : 0.035),
      H,
    });
  out[colourToken("stepper-button")] =
    fixed[colourToken("stepper-button")] ??
    fromOklch({
      L: dark ? 0.27 : 0.955,
      C: Math.min(C0, 0.035),
      H,
    });
  const grounds = BRAND_GROUNDS.map(get);
  const primary =
    fixed[PRIMARY] ??
    (choices.brandFix[mode] === true ? brandFixShade(brand, mode, grounds) : brand);
  const ink = dark ? fromOklch({ L: 0.16, C: Math.min(C0, 0.04), H }) : "#ffffff";
  const onPrimary =
    fixed[colourToken("on-primary")] ??
    (contrastRatio(ink, primary) >= 4.5
      ? ink
      : contrastRatio("#000000", primary) >= contrastRatio("#ffffff", primary)
        ? "#000000"
        : "#ffffff");
  const lifted = get(colourToken("surface-lifted"));
  const primaryText = until(brand, dark ? +1 : -1, [...grounds, lifted], 4.5);
  const away = relativeLuminance(onPrimary) > relativeLuminance(primary) ? -1 : +1;
  let hover = primary;
  search: for (const dir of [away, -away]) {
    for (let step = 1; step < 50; step++) {
      hover = withLightness(primary, toOklch(primary).L + dir * 0.02 * step);
      if (contrastRatio(hover, primary) >= 1.2 && contrastRatio(hover, onPrimary) >= 4.5) {
        break search;
      }
    }
  }
  const stationFills = STATION_FILLS.map((token) => d[token]!);
  const focus = until(
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
  /** The 25 theme tokens, Waitron's values wherever the derivation writes nothing. */
  readonly tokens: Record<string, string>;
  /** The rules still failing on the settled colours. */
  readonly failures: readonly RuleResult[];
  readonly tintStrength: number;
}

const failing = (defaults: WaitronDefaults, mode: Mode, tokens: Record<string, string>) =>
  checkRules(THEME_RULES[mode], (token) => (tokens[token] ?? defaults[mode][token])!).filter(
    (result) => !result.pass,
  );

/** One mode's hand-set values, keyed by full token name. */
export const handTokens = (
  values: Readonly<Partial<Record<ThemeColour, string>>>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [colourToken(key), value]));

const THEMED = new Set(THEME_COLOURS.map(colourToken));

/** Moves `from` in lightness, away from `against` or toward it for an at-most rule, until the rule passes or 200 steps run out. */
function push(rule: ContrastRule, from: string, against: string): string {
  const within = rule.kind === "at-most";
  const ground = relativeLuminance(against);
  const darker = ground > relativeLuminance(from);
  const dir = within === darker ? +1 : -1;
  const step = within ? 0.002 : 0.005;
  let L: number | null = toOklch(from).L;
  let out = from;
  for (let i = 0; i < 200 && !passes(rule, luminanceRatio(relativeLuminance(out), ground)); i++) {
    L = stepped(L, dir * step, i === 0);
    if (L === null) break;
    out = withLightness(from, L);
  }
  return out;
}

export function settleMode(
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): ModeResult {
  const isHand = (token: string) => token in hand;
  const tinted = Object.keys(TINT_TARGETS[mode])
    .map(colourToken)
    .filter((token) => !isHand(token));
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
    for (; strength >= -1e-9; strength -= 0.1) {
      const tokens = deriveAt(defaults, choices, mode, Math.max(0, strength), hand);
      if (!failing(defaults, mode, tokens).some(tintIn)) break;
    }
    strength = Math.max(0, Math.round(strength * 10) / 10);
  }
  const colourIn = (tokens: Record<string, string>, token: string) =>
    (tokens[token] ?? defaults[mode][token])!;
  const settled = (fixed: Readonly<Record<string, string>>) => {
    const written = deriveAt(defaults, choices, mode, strength, fixed);
    return { written, fails: failing(defaults, mode, written) };
  };
  const work: Record<string, string> = {};
  let current = settled({ ...hand });
  for (let round = 0; ; round++) {
    const { written, fails } = current;
    const failingNow = new Set(fails.map(({ rule }) => rule));
    // Departs from the reference: a move never newly fails a rule naming no colour the owner picked,
    // so every rule left failing names the brand colour or a hand-set value.
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
        if (!THEMED.has(token) || isHand(token) || token === PRIMARY) continue;
        const against = colourIn(written, other);
        const value = push(rule, colourIn(written, token), against);
        next = passes(rule, contrastRatio(value, against)) ? tried(token, value) : null;
        if (next !== null) {
          work[token] = value;
          break;
        }
      }
      if (next !== null) break;
    }
    // The 60th round's move is not settled, as in the reference.
    if (next === null || round === 59) break;
    current = next;
  }
  const { written, fails } = current;
  const tokens: Record<string, string> = {};
  for (const colour of THEME_COLOURS) {
    const token = colourToken(colour);
    tokens[token] = colourIn(written, token);
  }
  Object.assign(tokens, cornerRadii(choices.corners, defaults));
  return { tokens, failures: fails, tintStrength: strength };
}
