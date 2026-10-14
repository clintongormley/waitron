import { css, unsafeCSS } from "lit";
import { byStart, type Season } from "../season-rules.js";

type SeasonTint = "1" | "2" | "3" | "4";

/** The tokens that paint a season of each tint, spelt out so the token-name guard reads them. */
export const SEASON_TINT_TOKENS: Record<
  SeasonTint,
  { tint: string; onTint: string; line: string }
> = {
  "1": {
    tint: "var(--wt-color-season-1)",
    onTint: "var(--wt-color-on-season-1)",
    line: "var(--wt-color-season-1-line)",
  },
  "2": {
    tint: "var(--wt-color-season-2)",
    onTint: "var(--wt-color-on-season-2)",
    line: "var(--wt-color-season-2-line)",
  },
  "3": {
    tint: "var(--wt-color-season-3)",
    onTint: "var(--wt-color-on-season-3)",
    line: "var(--wt-color-season-3-line)",
  },
  "4": {
    tint: "var(--wt-color-season-4)",
    onTint: "var(--wt-color-on-season-4)",
    line: "var(--wt-color-season-4-line)",
  },
};
/** Every tint `seasonTints` hands out, in order. */
const SEASON_TINTS = Object.keys(SEASON_TINT_TOKENS) as SeasonTint[];

/** Each season's tint by its place in start order, cycled past the last of `SEASON_TINTS`. */
export function seasonTints(
  seasons: readonly Pick<Season, "id" | "startsOn">[],
): Map<string, string> {
  return new Map(
    byStart(seasons).map((season, index) => [
      season.id,
      SEASON_TINTS[index % SEASON_TINTS.length]!,
    ]),
  );
}

/** Sets `--season-tint`, `--season-on-tint` and `--season-tint-line` on each `[data-tint]` element
 *  for it and its descendants to paint with. */
export const seasonTintStyles = css`
  ${unsafeCSS(
    Object.entries(SEASON_TINT_TOKENS)
      .map(
        ([tint, { tint: fill, onTint, line }]) =>
          `[data-tint="${tint}"] { --season-tint: ${fill}; --season-on-tint: ${onTint}; --season-tint-line: ${line}; }`,
      )
      .join("\n"),
  )}
`;
