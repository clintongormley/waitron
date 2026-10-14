import { STATION_COLOURS } from "@waitron/shared";
import { expect, test } from "vitest";
import { STATION_COLOUR_TOKENS, stationColourStyles } from "./station-colour-styles.js";

test("names a fill and a dot token for each of the twelve station colours", () => {
  expect(Object.keys(STATION_COLOUR_TOKENS)).toEqual([...STATION_COLOURS]);
  for (const colour of STATION_COLOURS)
    expect(STATION_COLOUR_TOKENS[colour]).toEqual({
      fill: `var(--wt-color-station-${colour})`,
      dot: `var(--wt-color-station-${colour}-dot)`,
    });
});

test("sets the fill and dot on each element marked with a station colour", () => {
  for (const colour of STATION_COLOURS)
    expect(stationColourStyles.cssText).toContain(
      `[data-station-colour="${colour}"] { --station-fill: var(--wt-color-station-${colour}); --station-dot: var(--wt-color-station-${colour}-dot); }`,
    );
});
