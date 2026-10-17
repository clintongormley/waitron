import { describe, expect, it } from "vitest";
import { STATION_COLOURS, firstUnusedStationColour, isStationColour } from "./station-colours.js";

describe("station colours", () => {
  it.each([
    { used: [], expected: "red" },
    { used: ["red", "red", "blue"], expected: "orange" },
    { used: ["orange", "amber"], expected: "red" },
    { used: [...STATION_COLOURS], expected: "red" },
  ] as const)("chooses $expected after $used", ({ used, expected }) => {
    expect(firstUnusedStationColour(new Set(used))).toBe(expected);
  });

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
