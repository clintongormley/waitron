import { CALENDAR_COLOURS, isStationColour, type CalendarColour } from "@waitron/shared";
import { css, unsafeCSS } from "lit";
import { STATION_COLOUR_TOKENS } from "./station-colour-styles.js";

export const SEASON_TINT_TOKENS = Object.fromEntries(
  CALENDAR_COLOURS.map((colour) => [
    colour,
    {
      tint: STATION_COLOUR_TOKENS[colour].fill,
      onTint: "var(--wt-color-text)",
      line: STATION_COLOUR_TOKENS[colour].dot,
    },
  ]),
) as Record<CalendarColour, { tint: string; onTint: string; line: string }>;

/** Each season's tint is its stored colour; a colour no calendar colour names reads grey. */
export function seasonTints(
  seasons: readonly { id: string; colour: string }[],
): Map<string, CalendarColour> {
  return new Map(seasons.map(({ id, colour }) => [id, isStationColour(colour) ? colour : "grey"]));
}

/** Sets `--season-tint`, `--season-on-tint` and `--season-tint-line` on each `[data-tint]` element
 *  for it and its descendants to paint with. */
export const seasonTintStyles = css`
  ${unsafeCSS(
    Object.entries(SEASON_TINT_TOKENS)
      .map(
        ([colour, { tint, onTint, line }]) =>
          `[data-tint="${colour}"] { --season-tint: ${tint}; --season-on-tint: ${onTint}; --season-tint-line: ${line}; }`,
      )
      .join("\n"),
  )}
`;
