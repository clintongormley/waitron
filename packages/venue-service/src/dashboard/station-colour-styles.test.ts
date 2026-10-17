import { STATION_COLOURS } from "@waitron/shared";
import { expect, test } from "vitest";
import { STATION_COLOUR_TOKENS, stationColourStyles } from "./station-colour-styles.js";

test("names a fill and a dot token for each shared station colour", () => {
  expect(Object.keys(STATION_COLOUR_TOKENS)).toEqual([...STATION_COLOURS]);
  for (const colour of STATION_COLOURS)
    expect(STATION_COLOUR_TOKENS[colour]).toEqual({
      fill:
        colour === "grey"
          ? "color-mix(in srgb, var(--wt-color-palette-grey) 15%, var(--wt-color-surface))"
          : `var(--wt-color-station-${colour})`,
      dot:
        colour === "grey"
          ? "var(--wt-color-palette-grey)"
          : `var(--wt-color-station-${colour}-dot)`,
    });
});

test("sets the fill and dot on each element marked with a station colour", () => {
  for (const colour of STATION_COLOURS.filter((colour) => colour !== "grey"))
    expect(stationColourStyles.cssText).toContain(
      `[data-station-colour="${colour}"] { --station-fill: var(--wt-color-station-${colour}); --station-dot: var(--wt-color-station-${colour}-dot); }`,
    );
});

test("paints a shared palette extension without a separate station entry", () => {
  expect(STATION_COLOUR_TOKENS).toHaveProperty("grey", {
    fill: "color-mix(in srgb, var(--wt-color-palette-grey) 15%, var(--wt-color-surface))",
    dot: "var(--wt-color-palette-grey)",
  });
  expect(stationColourStyles.cssText).toContain(
    '[data-station-colour="grey"] { --station-fill: color-mix(in srgb, var(--wt-color-palette-grey) 15%, var(--wt-color-surface)); --station-dot: var(--wt-color-palette-grey); }',
  );
});
