import { css, unsafeCSS } from "lit";
import type { CalendarColour } from "../hours-types.js";

/** The tokens that paint a period of each colour, spelt out so the token-name guard reads them. */
export const PERIOD_COLOUR_TOKENS: Record<CalendarColour, { fill: string; onFill: string }> = {
  red: { fill: "var(--wt-color-palette-red)", onFill: "var(--wt-color-on-palette-red)" },
  amber: { fill: "var(--wt-color-palette-amber)", onFill: "var(--wt-color-on-palette-amber)" },
  grey: { fill: "var(--wt-color-palette-grey)", onFill: "var(--wt-color-on-palette-grey)" },
  blue: { fill: "var(--wt-color-palette-blue)", onFill: "var(--wt-color-on-palette-blue)" },
  green: { fill: "var(--wt-color-palette-green)", onFill: "var(--wt-color-on-palette-green)" },
  purple: { fill: "var(--wt-color-palette-purple)", onFill: "var(--wt-color-on-palette-purple)" },
};

/** Sets `--period-fill` and `--period-on-fill` on each `[data-colour]` element. */
export const periodColourStyles = css`
  ${unsafeCSS(
    Object.entries(PERIOD_COLOUR_TOKENS)
      .map(
        ([colour, { fill, onFill }]) =>
          `[data-colour="${colour}"] { --period-fill: ${fill}; --period-on-fill: ${onFill}; }`,
      )
      .join("\n"),
  )}
`;

/** The stripes that draw closed time, in the painter's grid and the Month's bars alike. */
export const closedHatch = css`repeating-linear-gradient(
  135deg,
  var(--wt-color-surface),
  var(--wt-color-surface) var(--wt-space-1),
  var(--wt-color-border) var(--wt-space-1),
  var(--wt-color-border) var(--wt-space-2)
)`;
