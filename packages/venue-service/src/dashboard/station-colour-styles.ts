import type { StationColour } from "@waitron/shared";
import { css, unsafeCSS } from "lit";

/** The tokens that paint a station of each colour, spelt out so the token-name guard reads them. */
export const STATION_COLOUR_TOKENS: Record<StationColour, { fill: string; dot: string }> = {
  red: { fill: "var(--wt-color-station-red)", dot: "var(--wt-color-station-red-dot)" },
  orange: { fill: "var(--wt-color-station-orange)", dot: "var(--wt-color-station-orange-dot)" },
  amber: { fill: "var(--wt-color-station-amber)", dot: "var(--wt-color-station-amber-dot)" },
  lime: { fill: "var(--wt-color-station-lime)", dot: "var(--wt-color-station-lime-dot)" },
  green: { fill: "var(--wt-color-station-green)", dot: "var(--wt-color-station-green-dot)" },
  teal: { fill: "var(--wt-color-station-teal)", dot: "var(--wt-color-station-teal-dot)" },
  cyan: { fill: "var(--wt-color-station-cyan)", dot: "var(--wt-color-station-cyan-dot)" },
  blue: { fill: "var(--wt-color-station-blue)", dot: "var(--wt-color-station-blue-dot)" },
  indigo: { fill: "var(--wt-color-station-indigo)", dot: "var(--wt-color-station-indigo-dot)" },
  purple: { fill: "var(--wt-color-station-purple)", dot: "var(--wt-color-station-purple-dot)" },
  pink: { fill: "var(--wt-color-station-pink)", dot: "var(--wt-color-station-pink-dot)" },
  brown: { fill: "var(--wt-color-station-brown)", dot: "var(--wt-color-station-brown-dot)" },
};

/** Sets `--station-fill` and `--station-dot` on each `[data-station-colour]` element. */
export const stationColourStyles = css`
  ${unsafeCSS(
    Object.entries(STATION_COLOUR_TOKENS)
      .map(
        ([colour, { fill, dot }]) =>
          `[data-station-colour="${colour}"] { --station-fill: ${fill}; --station-dot: ${dot}; }`,
      )
      .join("\n"),
  )}
`;
