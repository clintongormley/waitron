import { fromOklch, toOklch } from "./colour.js";
import { type ContrastRule, type RuleResult, STATIONS, THEME_RULES } from "./contrast-rules.js";
import type { Mode, WaitronDefaults } from "./defaults.js";
import { type Memo, type ModeResult, PRIMARY, failingIn, remember, settleMode } from "./derive.js";
import type { ThemeChoices, ThemeWarning } from "./theme.js";
import { THEME_COLOUR_TOKENS, type ThemeColour, colourKey, handTokens } from "./tokens.js";

const names = (failures: readonly RuleResult[], token: string) =>
  failures.filter(({ rule }) => rule.a === token || rule.b === token);

/** The colour `rule` holds `token` against. */
const otherOf = (rule: ContrastRule, token: string) => (rule.a === token ? rule.b : rule.a);

const otherSide = (results: readonly RuleResult[], token: string) =>
  [...new Set(results.map(({ rule }) => otherOf(rule, token)))].map(colourKey);

/** Hand-set tokens in `THEME_COLOURS` order. */
const handOrder = (hand: Readonly<Record<string, string>>) =>
  [...THEME_COLOUR_TOKENS].filter((token) => token in hand);

const LIGHTNESSES = Array.from({ length: 101 }, (_, i) => i / 100);

/**
 * `hex`'s hue at each hundredth of lightness, nearest first; lightnesses that round to one colour
 * give it once, so each colour is tried once.
 */
const shadesOf = (memo: Memo, hex: string): readonly string[] =>
  remember(memo.shades, hex, () => {
    const base = toOklch(hex);
    const order = [...LIGHTNESSES].sort((x, y) => Math.abs(x - base.L) - Math.abs(y - base.L));
    return [...new Set(order.map((L) => fromOklch({ ...base, L })))];
  });

/**
 * The nearest lightness of `token`'s hue at which, after settling with every other hand-set value
 * as typed, no rule names it, no rule between worked-out colours (the brand colour as picked is
 * not one) fails, and no other hand-set value is newly named; `null` when none does.
 */
function fixFor(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
  token: string,
  picked: ModeResult,
): string | null {
  const namedBefore = Object.keys(hand).filter((other) => names(picked.failures, other).length);
  const cannotMove = (other: string) => !THEME_COLOUR_TOKENS.has(other) || other in hand;
  const brandAsPicked = choices.brandColor !== null && choices.brandFix[mode] !== true;
  // A rule failing on the brand colour as picked is the brand's warning,
  // so it must not take away a hand-set colour's fix.
  const workedOut = ({ rule }: RuleResult, trial: Readonly<Record<string, string>>) =>
    !(rule.a in trial) &&
    !(rule.b in trial) &&
    !(brandAsPicked && [rule.a, rule.b].includes(PRIMARY));
  const quickRules = THEME_RULES[mode].filter(
    (rule) => [rule.a, rule.b].includes(token) && cannotMove(otherOf(rule, token)),
  );
  for (const candidate of shadesOf(memo, hand[token]!)) {
    const quick = failingIn(memo, quickRules, (other) =>
      other === token ? candidate : (picked.tokens[other] ?? defaults[mode][other])!,
    );
    if (quick.length > 0) continue;
    const trial = { ...hand, [token]: candidate };
    const { failures } = settleMode(memo, defaults, choices, mode, trial);
    const accepted =
      names(failures, token).length === 0 &&
      !failures.some((result) => workedOut(result, trial)) &&
      Object.keys(hand).every(
        (other) => names(failures, other).length === 0 || namedBefore.includes(other),
      );
    if (accepted) return candidate;
  }
  return null;
}

/**
 * The other hand-set colours each of which, worked out instead, would give `token` a fix; failing
 * that, when working them all out would, every other hand-set colour sharing a rule with it.
 */
function blockersOf(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
  token: string,
): string[] {
  const others = handOrder(hand).filter((other) => other !== token);
  const freedWithout = (drop: readonly string[]) => {
    const kept = Object.fromEntries(Object.entries(hand).filter(([key]) => !drop.includes(key)));
    const picked = settleMode(memo, defaults, choices, mode, kept);
    return (
      names(picked.failures, token).length === 0 ||
      fixFor(memo, defaults, choices, mode, kept, token, picked) !== null
    );
  };
  const single = others.filter((other) => freedWithout([other]));
  if (single.length > 0) return single.map(colourKey);
  // With one other, working out all the others is the single case already tried.
  if (others.length < 2 || !freedWithout(others)) return [];
  return others
    .filter((other) =>
      THEME_RULES[mode].some(
        (rule) => [rule.a, rule.b].includes(token) && otherOf(rule, token) === other,
      ),
    )
    .map(colourKey);
}

/** The rules failing on the brand colour as the owner picked or fixed it, against colours not set by hand. */
function brandFailures(
  choices: ThemeChoices,
  hand: Readonly<Record<string, string>>,
  settled: ModeResult,
): RuleResult[] {
  if (choices.brandColor === null || PRIMARY in hand) return [];
  return names(settled.failures, PRIMARY).filter(({ rule }) => !(otherOf(rule, PRIMARY) in hand));
}

function brandFixOffer(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
): string | null {
  const after = settleMode(
    memo,
    defaults,
    { ...choices, brandFix: { ...choices.brandFix, [mode]: true } },
    mode,
    hand,
  );
  // The offer is what the flag paints: hand-set colours can move the grounds between the two settles.
  return names(after.failures, PRIMARY).length > 0 ? null : after.tokens[PRIMARY]!;
}

/** `choices` must be normalised. */
export function warningsFor(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  settled: ModeResult,
): ThemeWarning[] {
  const hand = handTokens(choices.handSet[mode]);
  const warnings: ThemeWarning[] = [];
  const brandFails = brandFailures(choices, hand, settled);
  if (brandFails.length > 0) {
    warnings.push({
      field: "brandColor",
      mode,
      against: otherSide(brandFails, PRIMARY),
      fix: brandFixOffer(memo, defaults, choices, mode, hand),
      blockedBy: [],
    });
  }
  for (const token of handOrder(hand)) {
    const failing = names(settled.failures, token);
    if (failing.length === 0) continue;
    const fix = fixFor(memo, defaults, choices, mode, hand, token, settled);
    warnings.push({
      field: `handSet.${mode}.${colourKey(token) as ThemeColour}`,
      mode,
      against: otherSide(failing, token),
      fix,
      blockedBy: fix === null ? blockersOf(memo, defaults, choices, mode, hand, token) : [],
    });
  }
  return warnings;
}

/** Whether `warningsFor` would warn, without searching for a fix. `choices` must be normalised. */
export function warns(choices: ThemeChoices, mode: Mode, settled: ModeResult): boolean {
  const hand = handTokens(choices.handSet[mode]);
  return (
    brandFailures(choices, hand, settled).length > 0 ||
    settled.failures.some(({ rule }) => rule.a in hand || rule.b in hand)
  );
}

/** `colour` is null for the brand colour's fix flag. */
export type NextFix =
  { readonly colour: null } | { readonly colour: ThemeColour; readonly fix: string };

/**
 * Fix all's next step: in rule order, the first failing rule naming a warned colour with a fix; the
 * fix of the colour drawn on top in it if it has one, else of the other. `null` when no warning has
 * a fix. Searches only as far as that rule. `choices` must be normalised.
 */
export function nextFix(
  memo: Memo,
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  settled: ModeResult,
): NextFix | null {
  const hand = handTokens(choices.handSet[mode]);
  const brandWarns = brandFailures(choices, hand, settled).length > 0;
  const fixes = new Map<string, string | null>();
  const fixOf = (token: string) => {
    if (!fixes.has(token)) {
      fixes.set(
        token,
        token === PRIMARY && brandWarns
          ? brandFixOffer(memo, defaults, choices, mode, hand)
          : token in hand
            ? fixFor(memo, defaults, choices, mode, hand, token, settled)
            : null,
      );
    }
    return fixes.get(token)!;
  };
  for (const { rule } of settled.failures) {
    for (const token of [rule.a, rule.b]) {
      const fix = fixOf(token);
      if (fix === null) continue;
      return token === PRIMARY && brandWarns
        ? { colour: null }
        : { colour: colourKey(token) as ThemeColour, fix };
    }
  }
  return null;
}

export type AgainstItem =
  | { readonly kind: "colour"; readonly key: string }
  | { readonly kind: "station-fills" | "station-dots"; readonly count: number };

const STATION_FILLS = new Set<string>(STATIONS);
const STATION_DOTS = new Set(STATIONS.map((fill) => `${fill}-dot`));

/** Station fills and station dots each collapse into one counted item, placed where the first was. */
export function groupAgainst(against: readonly string[]): AgainstItem[] {
  const items: AgainstItem[] = [];
  const counts = { "station-fills": 0, "station-dots": 0 };
  for (const key of against) {
    const kind = STATION_DOTS.has(key)
      ? "station-dots"
      : STATION_FILLS.has(key)
        ? "station-fills"
        : null;
    if (kind === null) {
      items.push({ kind: "colour", key });
      continue;
    }
    if (counts[kind] === 0) items.push({ kind, count: 0 });
    counts[kind]++;
  }
  return items.map((item) =>
    item.kind === "colour" ? item : { ...item, count: counts[item.kind] },
  );
}
