import { css, unsafeCSS } from "lit";
import { byStart, type Season } from "../season-rules.js";

/** Every tint `seasonTints` hands out, in order. */
export const SEASON_TINTS = ["1", "2", "3", "4"] as const;

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

/** The `--wt-*` tokens that paint a season of `tint`. */
export function seasonTintTokens(tint: string) {
  return {
    tint: `--wt-color-season-${tint}`,
    onTint: `--wt-color-on-season-${tint}`,
    line: `--wt-color-season-${tint}-line`,
  };
}

/** Sets `--season-tint`, `--season-on-tint` and `--season-tint-line` on each `[data-tint]` element
 *  for it and its descendants to paint with, one block per `SEASON_TINTS` entry. */
export const seasonTintStyles = css`
  ${unsafeCSS(
    SEASON_TINTS.map((tint) => {
      const tokens = seasonTintTokens(tint);
      return `[data-tint="${tint}"] {
    --season-tint: var(${tokens.tint});
    --season-on-tint: var(${tokens.onTint});
    --season-tint-line: var(${tokens.line});
  }`;
    }).join("\n"),
  )}
`;
