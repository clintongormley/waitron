import { css } from "lit";
import { byStart, type Season } from "../season-rules.js";

const TINTS = 4;

/** Each season's tint, "1" to "4", by its place in start order, cycled past the fourth. */
export function seasonTints(
  seasons: readonly Pick<Season, "id" | "startsOn">[],
): Map<string, string> {
  return new Map(byStart(seasons).map((season, index) => [season.id, String((index % TINTS) + 1)]));
}

/** One block per tint, so `TINTS` above and this list change together. Sets `--season-tint`,
 *  `--season-on-tint` and `--season-tint-line` on each `[data-tint]` element for it and its
 *  descendants to paint with. */
export const seasonTintStyles = css`
  [data-tint="1"] {
    --season-tint: var(--wt-color-season-1);
    --season-on-tint: var(--wt-color-on-season-1);
    --season-tint-line: var(--wt-color-season-1-line);
  }
  [data-tint="2"] {
    --season-tint: var(--wt-color-season-2);
    --season-on-tint: var(--wt-color-on-season-2);
    --season-tint-line: var(--wt-color-season-2-line);
  }
  [data-tint="3"] {
    --season-tint: var(--wt-color-season-3);
    --season-on-tint: var(--wt-color-on-season-3);
    --season-tint-line: var(--wt-color-season-3-line);
  }
  [data-tint="4"] {
    --season-tint: var(--wt-color-season-4);
    --season-on-tint: var(--wt-color-on-season-4);
    --season-tint-line: var(--wt-color-season-4-line);
  }
`;
