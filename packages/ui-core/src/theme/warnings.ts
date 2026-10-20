import type { Mode, WaitronDefaults } from "./defaults.js";
import { type ModeResult, brandFixShade, settleMode } from "./derive.js";
import type { ThemeChoices, ThemeWarning } from "./theme.js";
import { colourToken } from "./tokens.js";

const PRIMARY = colourToken("primary");
const PREFIX = colourToken("");
const GROUNDS = ["bg", "surface", "surface-raised", "field-fill"].map(colourToken);

const namesPrimary = ({ rule }: ModeResult["failures"][number]) =>
  rule.a === PRIMARY || rule.b === PRIMARY;

export function warningsFor(
  defaults: WaitronDefaults,
  choices: ThemeChoices,
  mode: Mode,
  settled: ModeResult,
): ThemeWarning[] {
  const brand = choices.brandColor;
  if (brand === null || "primary" in choices.handSet[mode]) return [];
  const brandFails = settled.failures.filter(namesPrimary);
  if (brandFails.length === 0) return [];
  const against = [
    ...new Set(brandFails.map(({ rule }) => (rule.a === PRIMARY ? rule.b : rule.a))),
  ].map((token) => token.slice(PREFIX.length));
  const shade = brandFixShade(
    brand,
    mode,
    GROUNDS.map((token) => settled.tokens[token]!),
  );
  const after = settleMode(
    defaults,
    { ...choices, brandFix: { ...choices.brandFix, [mode]: true } },
    mode,
    {},
  );
  const fix = after.failures.some(namesPrimary) ? null : shade;
  return [{ field: "brandColor", mode, against, fix, blockedBy: [] }];
}
