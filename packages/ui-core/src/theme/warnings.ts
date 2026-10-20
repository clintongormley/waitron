import { fromOklch, toOklch } from "./colour.js";
import { THEME_RULES, checkRules, type RuleResult } from "./contrast-rules.js";
import type { Mode, WaitronDefaults } from "./defaults.js";
import { type ModeResult, handTokens, settleMode } from "./derive.js";
import type { ThemeChoices, ThemeWarning } from "./theme.js";
import { THEME_COLOURS, type ThemeColour, colourToken } from "./tokens.js";

const PRIMARY = colourToken("primary");
const PREFIX = colourToken("");
const THEMED = new Set(THEME_COLOURS.map(colourToken));

const names = (failures: readonly RuleResult[], token: string) =>
  failures.filter(({ rule }) => rule.a === token || rule.b === token);

const otherSide = (results: readonly RuleResult[], token: string) =>
  [...new Set(results.map(({ rule }) => (rule.a === token ? rule.b : rule.a)))].map((other) =>
    other.slice(PREFIX.length),
  );

/** Hand-set tokens in `THEME_COLOURS` order. */
const handOrder = (hand: Readonly<Record<string, string>>) =>
  THEME_COLOURS.map(colourToken).filter((token) => token in hand);

const LIGHTNESSES = Array.from({ length: 101 }, (_, i) => i / 100);

/**
 * The nearest lightness of `token`'s hue at which, after settling with every other hand-set value
 * as typed, no rule names it, no rule between worked-out colours (the brand colour as picked is
 * not one) fails, and no other hand-set value is newly named; `null` when none does.
 */
function fixFor(
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
  token: string,
  picked: ModeResult,
): string | null {
  const namedBefore = Object.keys(hand).filter((other) => names(picked.failures, other).length);
  const base = toOklch(hand[token]!);
  const order = [...LIGHTNESSES].sort((x, y) => Math.abs(x - base.L) - Math.abs(y - base.L));
  const cannotMove = (other: string) => !THEMED.has(other) || other in hand;
  const brandAsPicked =
    choices.brandColor !== null && choices.brandFix[mode] !== true && !(PRIMARY in hand);
  // Departs from the reference: a rule failing on the brand colour as picked is the brand's warning,
  // so it must not take away a hand-set colour's fix (a null fix means no shade of it works).
  const workedOut = ({ rule }: RuleResult, trial: Readonly<Record<string, string>>) =>
    !(rule.a in trial) &&
    !(rule.b in trial) &&
    !(brandAsPicked && (rule.a === PRIMARY || rule.b === PRIMARY));
  const quickRules = THEME_RULES[mode].filter(
    (rule) => (rule.a === token && cannotMove(rule.b)) || (rule.b === token && cannotMove(rule.a)),
  );
  // A lightness that rounds to a colour already tried gets the same answer, which was no.
  const tried = new Set<string>();
  for (const L of order) {
    const candidate = fromOklch({ ...base, L });
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const quick = checkRules(quickRules, (other) =>
      other === token ? candidate : (picked.tokens[other] ?? defaults[mode][other])!,
    );
    if (quick.some((result) => !result.pass)) continue;
    const trial = { ...hand, [token]: candidate };
    const { failures } = settleMode(defaults, choices, mode, trial);
    const accepted =
      names(failures, token).length === 0 &&
      !failures.some((result) => workedOut(result, trial)) &&
      Object.keys(hand).every(
        (other) =>
          other === token || names(failures, other).length === 0 || namedBefore.includes(other),
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
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
  token: string,
): string[] {
  const others = handOrder(hand).filter((other) => other !== token);
  const freedWithout = (drop: readonly string[]) => {
    const kept = Object.fromEntries(Object.entries(hand).filter(([key]) => !drop.includes(key)));
    const picked = settleMode(defaults, choices, mode, kept);
    return (
      names(picked.failures, token).length === 0 ||
      fixFor(defaults, choices, mode, kept, token, picked) !== null
    );
  };
  const single = others.filter((other) => freedWithout([other]));
  if (single.length > 0) return single.map((other) => other.slice(PREFIX.length));
  // With one other, working out all the others is the single case already tried.
  if (others.length < 2 || !freedWithout(others)) return [];
  return others
    .filter((other) =>
      THEME_RULES[mode].some(
        (rule) => (rule.a === token && rule.b === other) || (rule.b === token && rule.a === other),
      ),
    )
    .map((other) => other.slice(PREFIX.length));
}

/** The rules failing on the brand colour as the owner picked or fixed it, against colours not set by hand. */
function brandFailures(
  choices: ThemeChoices,
  hand: Readonly<Record<string, string>>,
  settled: ModeResult,
): RuleResult[] {
  if (choices.brandColor === null || PRIMARY in hand) return [];
  return settled.failures.filter(
    ({ rule }) =>
      (rule.a === PRIMARY && !(rule.b in hand)) || (rule.b === PRIMARY && !(rule.a in hand)),
  );
}

function brandFixOffer(
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  hand: Readonly<Record<string, string>>,
  settled: ModeResult,
): string | null {
  const after =
    choices.brandFix[mode] === true
      ? settled
      : settleMode(
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
      fix: brandFixOffer(defaults, choices, mode, hand, settled),
      blockedBy: [],
    });
  }
  for (const token of handOrder(hand)) {
    const failing = names(settled.failures, token);
    if (failing.length === 0) continue;
    const fix = fixFor(defaults, choices, mode, hand, token, settled);
    warnings.push({
      field: `handSet.${mode}.${token.slice(PREFIX.length) as ThemeColour}`,
      mode,
      against: otherSide(failing, token),
      fix,
      blockedBy: fix === null ? blockersOf(defaults, choices, mode, hand, token) : [],
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

export type NextFix =
  | { readonly kind: "brand" }
  | { readonly kind: "hand"; readonly colour: ThemeColour; readonly fix: string };

/**
 * Fix all's next step: in rule order, the first failing rule naming a warned colour with a fix; the
 * fix of the colour drawn on top in it if it has one, else of the other. `null` when no warning has
 * a fix. Searches only as far as that rule. `choices` must be normalised.
 */
export function nextFix(
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
          ? brandFixOffer(defaults, choices, mode, hand, settled)
          : token in hand
            ? fixFor(defaults, choices, mode, hand, token, settled)
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
        ? { kind: "brand" }
        : { kind: "hand", colour: token.slice(PREFIX.length) as ThemeColour, fix };
    }
  }
  return null;
}

export type AgainstItem =
  | { readonly kind: "colour"; readonly key: string }
  | { readonly kind: "station-fills" | "station-dots"; readonly count: number };

const STATION_FILL = /^station-[a-z]+$/;
const STATION_DOT = /^station-[a-z]+-dot$/;

/** Station fills and station dots each collapse into one counted item, placed where the first was. */
export function groupAgainst(against: readonly string[]): AgainstItem[] {
  const items: AgainstItem[] = [];
  const counts = { "station-fills": 0, "station-dots": 0 };
  for (const key of against) {
    const kind = STATION_DOT.test(key)
      ? "station-dots"
      : STATION_FILL.test(key)
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
