import { css, unsafeCSS } from "lit";
import { CALENDAR_COLOURS, type CalendarColour } from "../hours-types.js";

/** The `--wt-*` tokens that paint a period of `colour`. */
export function periodColourTokens(colour: CalendarColour) {
  return { fill: `--wt-color-palette-${colour}`, onFill: `--wt-color-on-palette-${colour}` };
}

/** Sets `--period-fill` and `--period-on-fill` on each `[data-colour]` element, one block per
 *  `CALENDAR_COLOURS` entry. */
export const periodColourStyles = css`
  ${unsafeCSS(
    CALENDAR_COLOURS.map((colour) => {
      const tokens = periodColourTokens(colour);
      return `[data-colour="${colour}"] {
    --period-fill: var(${tokens.fill});
    --period-on-fill: var(${tokens.onFill});
  }`;
    }).join("\n"),
  )}
`;
