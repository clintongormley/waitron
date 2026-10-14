import { describe, expect, it } from "vitest";
import { STATION_COLOURS, isStationColour } from "./station-colours.js";

describe("station colours", () => {
  it("lists the twelve station colours in the editor's order", () => {
    expect(STATION_COLOURS).toEqual([
      "red",
      "orange",
      "amber",
      "lime",
      "green",
      "teal",
      "cyan",
      "blue",
      "indigo",
      "purple",
      "pink",
      "brown",
    ]);
  });

  it("accepts each of the twelve and nothing else", () => {
    for (const colour of STATION_COLOURS) expect(isStationColour(colour)).toBe(true);
    for (const value of ["grey", "Red", "", " red", null, 3])
      expect(isStationColour(value)).toBe(false);
  });
});
